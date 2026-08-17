#!/usr/bin/env python3
"""Delete every trace of a tournament — DB rows, seed block, and cache entry.

A bogus event (wrong format, duplicate, junk import) lives in three places, and
clearing only the first means it walks straight back in on the next rebuild:

  1. the database — the `tournaments` row, which cascades to its
     `tournament_decks` and `tournament_deck_cards`
  2. supabase/seeds/tournaments.sql — the committed fixture `supabase db reset`
     replays, which would otherwise reinsert the event wholesale
  3. scripts/_tournament_cache/<source>.json — the local archive that
     `ingest_tournaments.py --from-cache` re-ingests from

Targets are either the id in the app's URL (…/tournaments/30) or the stable
`source/external_id` identity, which — unlike the serial id — survives a reseed:

    python scripts/delete_tournament.py 30
    python scripts/delete_tournament.py spellbinder/2921762 --yes

`--dry-run` reports what would go without touching anything. This does not stop
a later `ingest_tournaments.py` run from re-fetching the event from its source;
for that the event needs to be filtered out at ingest time.

Stdlib only, and DB access goes through the `psql` CLI, matching
ingest_tournaments.py — whose helpers it reuses so the seed it rewrites stays
byte-compatible with the one `--snapshot` generates.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_tournaments import (  # noqa: E402
    CACHE_DIR,
    LOCAL_DB_URL,
    SEED_PATH,
    apply_sql,
    lit,
    load_env,
    snapshot_sql,
    write_snapshot,
)

SEP = "\x1f"  # psql field separator — event names contain | and tabs, never this


def target_where(target: str) -> str:
    """SQL predicate for one CLI target: a numeric id or `source/external_id`."""
    if target.isdigit():
        return f"id = {int(target)}"
    source, slash, external_id = target.partition("/")
    if not slash or not source or not external_id:
        sys.exit(f"error: {target!r} is neither a numeric id nor source/external_id")
    return f"source = {lit(source)} and external_id = {lit(external_id)}"


def lookup(where: str, db_url: str) -> list[dict]:
    """The matching events, with the child-row counts about to go with them."""
    sql = (
        "select t.id, coalesce(t.source, ''), coalesce(t.external_id, ''), t.name,"
        " coalesce(t.format, '-'), coalesce(t.held_on::text, '-'),"
        " (select count(*) from tournament_decks d where d.tournament_id = t.id),"
        " (select count(*) from tournament_deck_cards c"
        "  join tournament_decks d on d.id = c.tournament_deck_id"
        "  where d.tournament_id = t.id)"
        f" from tournaments t where {where} order by t.id"
    )
    out = subprocess.run(
        ["psql", db_url, "-tA", "-F", SEP, "-c", sql], capture_output=True, text=True, check=True
    ).stdout
    keys = ("id", "source", "external_id", "name", "format", "held_on", "decks", "cards")
    return [dict(zip(keys, line.split(SEP))) for line in out.splitlines() if line]


def purge_db(rows: list[dict], db_url: str) -> None:
    """Delete the event rows; the FK cascades take the decks and their cards."""
    # Curated sample events have a NULL source, so their (source, external_id)
    # identity doesn't select — fall back to the serial id for those.
    preds = [
        f"(source = {lit(r['source'])} and external_id = {lit(r['external_id'])})"
        if r["source"] and r["external_id"]
        else f"id = {int(r['id'])}"
        for r in rows
    ]
    apply_sql(f"delete from tournaments where {' or '.join(preds)};", db_url)
    print(f"  database: {len(rows)} event(s) deleted", file=sys.stderr)


def purge_seed(keys: set[tuple[str, str]], dry_run: bool) -> None:
    """Drop each event's block from the committed seed and rewrite the header.

    The snapshot is `header + "begin;" + one block per event + "commit;"`, all
    joined by a blank line and none containing one, so splitting on "\n\n"
    recovers the blocks exactly. Anything else means the file was hand-edited —
    say so and leave it alone rather than mangle it.
    """
    if not keys or not SEED_PATH.exists():
        return
    chunks = SEED_PATH.read_text(encoding="utf-8").split("\n\n")
    if len(chunks) < 4 or chunks[1].strip() != "begin;" or not chunks[-1].startswith("commit;"):
        print(f"  warning: {SEED_PATH.name} is not in snapshot form; left untouched", file=sys.stderr)
        return
    blocks = chunks[2:-1]
    # Match on the identity predicate the generator embeds in every block, which
    # is exact where the `-- source id — name` header comment could collide.
    ids = {f"source = {lit(s)} and external_id = {lit(e)}" for s, e in keys}
    kept = [b for b in blocks if not any(i in b for i in ids)]
    dropped = len(blocks) - len(kept)
    if not dropped:
        print(f"  {SEED_PATH.name}: no matching block", file=sys.stderr)
    elif dry_run:
        print(f"  would drop {dropped} block(s) from {SEED_PATH.name}, leaving {len(kept)}", file=sys.stderr)
    else:
        write_snapshot(snapshot_sql(kept), len(kept))


def purge_cache(keys: set[tuple[str, str]], cache_dir: Path, dry_run: bool) -> None:
    """Drop the events from their source's scripts/_tournament_cache file."""
    by_source: dict[str, set[str]] = {}
    for source, external_id in keys:
        by_source.setdefault(source, set()).add(external_id)
    for source, ids in sorted(by_source.items()):
        path = cache_dir / f"{source}.json"
        if not path.exists():
            continue
        events = json.loads(path.read_text(encoding="utf-8"))
        kept = [e for e in events if e.get("external_id") not in ids]
        if len(kept) == len(events):
            continue
        if dry_run:
            print(f"  would drop {len(events) - len(kept)} event(s) from {path.name}", file=sys.stderr)
            continue
        path.write_text(json.dumps(kept), encoding="utf-8")
        print(f"  {path.name}: {len(events) - len(kept)} event(s) removed, {len(kept)} left", file=sys.stderr)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Delete a tournament and every row, seed block, and cache entry for it.")
    p.add_argument("target", nargs="+", metavar="TARGET", help="tournament id (…/tournaments/30) or source/external_id")
    p.add_argument("--db-url", default=os.environ.get("DATABASE_URL", LOCAL_DB_URL), help="target DB (default: $DATABASE_URL or local)")
    p.add_argument("--dry-run", action="store_true", help="report what would be deleted, change nothing")
    p.add_argument("-y", "--yes", action="store_true", help="skip the confirmation prompt")
    p.add_argument("--keep-seed", action="store_true", help="leave supabase/seeds/tournaments.sql alone")
    p.add_argument("--keep-cache", action="store_true", help="leave scripts/_tournament_cache alone")
    p.add_argument("--cache-dir", type=Path, default=CACHE_DIR, help=f"cache location (default: {CACHE_DIR})")
    return p.parse_args(argv)


def main(argv=None):
    load_env()  # before parse_args so a .env DATABASE_URL feeds the --db-url default
    args = parse_args(argv)

    rows: list[dict] = []
    keys: set[tuple[str, str]] = set()  # (source, external_id) — what seed/cache are keyed on
    for target in args.target:
        found = lookup(target_where(target), args.db_url)
        if not found and "/" in target:
            # Already gone from the DB, but the seed and cache can still hold it,
            # which is exactly how it would come back on the next reset.
            source, _, external_id = target.partition("/")
            keys.add((source, external_id))
            print(f"{target}: not in the database; purging seed and cache only", file=sys.stderr)
            continue
        if not found:
            print(f"{target}: no such tournament", file=sys.stderr)
            continue
        rows.extend(found)
        keys.update((r["source"], r["external_id"]) for r in found if r["source"] and r["external_id"])

    if not rows and not keys:
        sys.exit("Nothing to delete.")

    for r in rows:
        print(
            f"{r['id']}  {r['source'] or '-'}/{r['external_id'] or '-'}  [{r['format']}, {r['held_on']}]"
            f"  {r['name']}\n    {r['decks']} decks, {r['cards']} deck cards",
            file=sys.stderr,
        )

    if not args.dry_run and not args.yes:
        if input("Delete these? [y/N] ").strip().lower() not in ("y", "yes"):
            sys.exit("Aborted.")

    if rows:
        if args.dry_run:
            print(f"  would delete {len(rows)} event(s) from the database", file=sys.stderr)
        else:
            purge_db(rows, args.db_url)
    if not args.keep_seed:
        purge_seed(keys, args.dry_run)
    if not args.keep_cache:
        purge_cache(keys, args.cache_dir, args.dry_run)


if __name__ == "__main__":
    main()
