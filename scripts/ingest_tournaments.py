#!/usr/bin/env python3
"""Ingest tournament results into the Manaring database.

One method that works the same locally and in production: fetch normalized
``Tournament`` objects from the registered sources (scripts/tournament_sources),
turn them into *idempotent* upsert SQL keyed on ``(source, external_id)``, and
apply that SQL to whatever ``DATABASE_URL`` points at. The only thing that
differs between environments is the connection string:

    # local (default)
    python scripts/ingest_tournaments.py --source mtgo

    # production — same command, different target
    DATABASE_URL="$SUPABASE_DB_URL" python scripts/ingest_tournaments.py --source mtgo

Because the SQL upserts (and rebuilds each event's decks from scratch), running
it repeatedly converges instead of duplicating — safe in either environment.

Each event is applied in its own transaction the moment it's fetched, so a long
run that errors out (or is interrupted) keeps everything ingested so far instead
of rolling the whole batch back. A single event that fails to apply is reported
and skipped rather than aborting the run.

``--snapshot`` additionally writes the generated SQL to
supabase/seeds/tournaments.sql so the committed fixture that ``supabase db
reset`` loads stays in sync with what you ingested locally.

Every network fetch is also cached to disk (scripts/_tournament_cache/<source>.json,
gitignored), merged by ``(source, external_id)`` so the cache accumulates into a
local archive. ``--from-cache`` re-ingests from those files instead of hitting the
network — the fast way to repopulate after a ``supabase db reset`` without
re-downloading every event. ``--no-cache`` skips writing the cache.

Stdlib only; DB access is delegated to the ``psql`` CLI (already required by the
Supabase workflow), so there is no driver dependency. Card names are resolved by
joining against ``cards`` in SQL — names with no matching row are skipped, same
as the existing curated seed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tournament_sources import SOURCES, Deck, DeckCard, Tournament  # noqa: E402

LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "supabase" / "seeds" / "tournaments.sql"
CACHE_DIR = Path(__file__).resolve().parent / "_tournament_cache"  # gitignored (_*), one JSON per source
ENV_PATH = ROOT / ".env"  # gitignored KEY=VALUE file for secrets like TOPDECK_API_KEY


def load_env(path: Path = ENV_PATH) -> None:
    """Load KEY=VALUE lines from the repo-root .env into the environment.

    Real environment variables win over the file, so a one-off override on the
    command line still works. Blank lines, comments, and quotes are tolerated.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.removeprefix("export ").partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def lit(value) -> str:
    """Quote a string as a SQL literal, or NULL."""
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def num(value) -> str:
    return "null" if value in (None, "") else str(int(value))


class Resolver:
    """Maps a source's card name to the canonical ``cards.name``.

    Sources don't all spell multi-part cards the way Scryfall (and thus our
    `cards` table) does. MTGO, for instance, reports the front face of a
    double-faced/adventure card ("Brazen Borrower") and joins split halves with
    a slash ("Wear/Tear"), where `cards` stores "Brazen Borrower // Petty Theft"
    and "Wear // Tear". This resolves both forms back to the canonical name so
    those cards aren't silently dropped on the name join.

    Resolution order, exact match first so a standalone card never loses to a
    same-named split half:
      1. exact ``cards.name``
      2. slash split   — "Wear/Tear" -> "Wear // Tear"
      3. front face     — "Brazen Borrower" -> "Brazen Borrower // Petty Theft"

    A name that still doesn't match is genuinely absent from the dataset (e.g. a
    card newer than the seed) and is returned as ``None`` to be reported.
    """

    def __init__(self, names: set[str]):
        self.exact = names
        self.front: dict[str, str] = {}
        for n in names:
            if " // " in n:
                self.front.setdefault(n.split(" // ", 1)[0], n)

    @classmethod
    def from_db(cls, db_url: str) -> "Resolver":
        try:
            out = subprocess.run(
                ["psql", db_url, "-tAc", "select name from cards"],
                capture_output=True, text=True, check=True,
            ).stdout
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            print(f"warning: could not load card names ({exc}); using exact names only", file=sys.stderr)
            return cls(set())
        return cls({line for line in out.splitlines() if line})

    def resolve(self, name: str) -> str | None:
        if not self.exact:  # index unavailable — defer to the SQL name join
            return name
        if name in self.exact:
            return name
        if "/" in name:
            split = " // ".join(p.strip() for p in name.split("/"))
            if split in self.exact:
                return split
        return self.front.get(name)


def tournament_from_dict(d: dict) -> Tournament:
    decks = [Deck(cards=[DeckCard(**c) for c in dk.pop("cards", [])], **dk) for dk in d.pop("decks", [])]
    return Tournament(decks=decks, **d)


def load_cache(source: str, cache_dir: Path, since=None) -> list[Tournament]:
    path = cache_dir / f"{source}.json"
    if not path.exists():
        return []
    cutoff = since.isoformat() if since else None
    return [
        t for t in (tournament_from_dict(d) for d in json.loads(path.read_text(encoding="utf-8")))
        if not (cutoff and t.held_on and t.held_on < cutoff)
    ]


def write_cache(source: str, tournaments: list[Tournament], cache_dir: Path) -> None:
    """Merge ``tournaments`` into the source's cache file, keyed by external_id."""
    merged = {t.external_id: t for t in load_cache(source, cache_dir)}
    merged.update((t.external_id, t) for t in tournaments)
    ordered = sorted(merged.values(), key=lambda t: (t.held_on or "", t.external_id))
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"{source}.json").write_text(json.dumps([asdict(t) for t in ordered]), encoding="utf-8")
    print(f"  cached {len(ordered)} events in {cache_dir / f'{source}.json'}", file=sys.stderr)


def tournament_sql(t: Tournament, resolver: Resolver, unresolved: Counter) -> str:
    """Idempotent SQL for one event: upsert the row, then rebuild its decks.

    Identity is ``(source, external_id)``. The event row is upserted; its decks
    are deleted (cascading to tournament_deck_cards) and re-inserted, so a
    re-import always reflects the latest published list without duplicating.
    Each deck is inserted in a CTE that RETURNs its generated id, which the card
    rows then reference — no reliance on placement/player being unique.
    """
    key = f"source = {lit(t.source)} and external_id = {lit(t.external_id)}"
    # format is guarded by a subselect so an unmapped code inserts NULL rather
    # than violating the formats FK.
    fmt = f"(select code from formats where code = {lit(t.format)})"
    out = [
        f"-- {t.source} {t.external_id} — {t.name}",
        "insert into tournaments"
        " (source, external_id, name, format, held_on, location, source_url, player_count)\nvalues\n"
        f"  ({lit(t.source)}, {lit(t.external_id)}, {lit(t.name)}, {fmt}, "
        f"{lit(t.held_on)}, {lit(t.location)}, {lit(t.source_url)}, {num(t.player_count)})\n"
        "on conflict (source, external_id) do update set\n"
        "  name = excluded.name, format = excluded.format, held_on = excluded.held_on,\n"
        "  location = excluded.location, source_url = excluded.source_url,"
        " player_count = excluded.player_count;",
        f"delete from tournament_decks where tournament_id = (select id from tournaments where {key});",
    ]
    for d in t.decks:
        deck_cols = (
            f"id, {lit(d.player)}, {lit(d.archetype)}, "
            f"{num(d.placement)}, {num(d.wins)}, {num(d.losses)}, {num(d.draws)}"
        )
        deck_insert = (
            "with d as (\n"
            "  insert into tournament_decks"
            " (tournament_id, player, archetype, placement, wins, losses, draws)\n"
            f"  select {deck_cols} from tournaments where {key}\n"
            "  returning id\n"
            ")"
        )
        # Resolve to canonical names, then collapse duplicate (name, board)
        # lines — sources may split one card across several printing entries (or
        # spellings) that resolve to the same cards row, which would otherwise
        # violate the (deck, card_id, board) unique key.
        merged: dict[tuple[str, str], int] = {}
        for c in d.cards:
            canon = resolver.resolve(c.name)
            if canon is None:
                unresolved[c.name] += 1
                continue
            merged[(canon, c.board)] = merged.get((canon, c.board), 0) + c.quantity
        if not merged:
            out.append(deck_insert + "\nselect 1 from d;")
            continue
        values = ",\n".join(f"  ({lit(n)}, {q}, {lit(b)})" for (n, b), q in merged.items())
        out.append(
            deck_insert + "\n"
            "insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)\n"
            "select d.id, c.id, v.qty, v.board\n"
            f"from d, (values\n{values}\n) as v(name, qty, board) join cards c on c.name = v.name;"
        )
    return "\n".join(out)


def report_unresolved(unresolved: Counter) -> None:
    if not unresolved:
        return
    top = ", ".join(f"{n} (x{c})" for n, c in unresolved.most_common(8))
    print(
        f"  {len(unresolved)} card names unresolved, {sum(unresolved.values())} entries skipped: {top}"
        + (" ..." if len(unresolved) > 8 else ""),
        file=sys.stderr,
    )


def apply_sql(sql: str, db_url: str) -> None:
    subprocess.run(
        ["psql", db_url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input=sql,
        text=True,
        check=True,
    )


def write_snapshot(sql: str, count: int) -> None:
    header = (
        "-- Tournament results, generated by scripts/ingest_tournaments.py --snapshot.\n"
        f"-- {count} events. Loaded after seed.sql so the `cards` table exists; the\n"
        "-- card-name joins skip any card absent from the current dataset, and the\n"
        "-- (source, external_id) upserts make a `supabase db reset` reload idempotent.\n\n"
    )
    SEED_PATH.write_text(header + sql, encoding="utf-8")
    print(f"Wrote {SEED_PATH} ({count} events).", file=sys.stderr)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Ingest tournament results into the database.")
    p.add_argument("--source", action="append", choices=sorted(SOURCES), help="source(s) to ingest (default: all)")
    p.add_argument("--format", action="append", metavar="CODE", help="only events matching this formats.code (repeatable; default: all)")
    p.add_argument("--since", type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(), help="only events on/after YYYY-MM-DD")
    p.add_argument("--db-url", default=os.environ.get("DATABASE_URL", LOCAL_DB_URL), help="target DB (default: $DATABASE_URL or local)")
    p.add_argument("--snapshot", action="store_true", help="also write supabase/seeds/tournaments.sql")
    p.add_argument("--from-cache", action="store_true", help="re-ingest from scripts/_tournament_cache instead of the network")
    p.add_argument("--no-cache", action="store_true", help="do not write fetched data to the cache")
    p.add_argument("--cache-dir", type=Path, default=CACHE_DIR, help=f"cache location (default: {CACHE_DIR})")
    p.add_argument("--dry-run", action="store_true", help="print SQL instead of applying it")
    return p.parse_args(argv)


def main(argv=None):
    load_env()  # before parse_args so a .env DATABASE_URL feeds the --db-url default
    args = parse_args(argv)
    names = args.source or sorted(SOURCES)
    formats = {f.lower() for f in args.format} if args.format else None
    resolver = Resolver.from_db(args.db_url)

    unresolved: Counter = Counter()
    parts: list[str] = []  # per-event SQL, accumulated for the optional snapshot
    applied = failed = 0

    for n in names:
        if args.from_cache:
            print(f"Loading {n} from cache...", file=sys.stderr)
            stream = load_cache(n, args.cache_dir, args.since)
        else:
            print(f"Fetching from {n}...", file=sys.stderr)
            stream = SOURCES[n].fetch(args.since, formats)
        fetched: list[Tournament] = []
        for t in stream:
            if formats is not None and (t.format or "").lower() not in formats:
                continue
            fetched.append(t)
            sql = tournament_sql(t, resolver, unresolved)
            parts.append(sql)
            if args.dry_run:
                sys.stdout.write(f"begin;\n\n{sql}\n\ncommit;\n\n")
                applied += 1
                continue
            try:
                apply_sql(f"begin;\n{sql}\ncommit;\n", args.db_url)  # own transaction: persisted as we go
                applied += 1
            except subprocess.CalledProcessError as exc:
                failed += 1
                print(f"  ! failed to apply {t.source} {t.external_id}: {exc}", file=sys.stderr)
        print(f"  {len(fetched)} events", file=sys.stderr)
        if fetched and not args.from_cache and not args.no_cache:
            write_cache(n, fetched, args.cache_dir)

    report_unresolved(unresolved)

    if not parts:
        print("No tournaments fetched; nothing to do.", file=sys.stderr)
        return
    if not args.dry_run:
        print(
            f"Applied {applied} events to {args.db_url.split('@')[-1]}"
            + (f" ({failed} failed)." if failed else "."),
            file=sys.stderr,
        )
    if args.snapshot:
        write_snapshot("begin;\n\n" + "\n\n".join(parts) + "\n\ncommit;\n", len(parts))


if __name__ == "__main__":
    main()
