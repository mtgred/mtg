#!/usr/bin/env python3
"""Refresh cards, sets and printings in a live database from Scryfall.

The alternative — regenerating supabase/seed.sql and running ``supabase db
reset`` — is destructive: the seed opens with ``truncate ... cascade``, which
also empties deck_cards and tournament_deck_cards, and it renumbers cards.id
(ids are assigned by first-appearance order in the bulk export), so anything
holding card ids is lost. This updates in place instead:

  * sets are upserted on ``code``, cards on ``oracle_id``, printings on their
    Scryfall ``id``. Existing rows keep their surrogate ids, so decks and
    tournament decklists keep pointing at the right cards.
  * new rows take fresh SERIAL ids, keeping the sequences in step with no
    setval fixup.
  * rows that vanished from Scryfall are pruned (see --no-prune), except cards
    still referenced by a deck or a tournament decklist: those are kept and
    reported rather than deleted, since deleting them would break the FK. A
    prune that would remove more than 5% of a table aborts the run, on the
    theory that it means mismatched flags rather than upstream deletions;
    --force overrides it.
  * everything runs in one transaction, so a failure leaves the data untouched.

Usage:
    python scripts/refresh_cards.py
    python scripts/refresh_cards.py --dry-run
    DATABASE_URL="$SUPABASE_DB_URL" python scripts/refresh_cards.py

Fetching and column mapping are reused from generate_seed.py, so the two stay
in sync; this module only differs in how the rows reach the database. Same
shape as the other ingest scripts: stdlib only, DB access via the psql CLI,
targets $DATABASE_URL (or the local stack by default).

Note this leaves supabase/seed.sql untouched — a later ``supabase db reset``
still reloads whatever that file holds. Re-run generate_seed.py if you want the
reset path to carry the same data (its ids will differ; that is what the seed's
truncate-and-reload assumes).
"""

from __future__ import annotations

import argparse
import itertools
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_seed import (  # noqa: E402
    BATCH_SIZE,
    CARD_COLUMNS,
    PRINTING_COLUMNS,
    SET_COLUMNS,
    fetch_sets,
    is_real_card,
    iter_bulk_cards,
    lit_str,
    oracle_fields,
    printing_fields,
    set_fields,
)
from ingest_tournaments import LOCAL_DB_URL, load_env  # noqa: E402

# Staging mirrors the target tables minus the surrogate keys the database owns:
# sets/cards get their ids from the existing row (or the sequence), and a
# printing carries the natural keys of its card and set instead of ids that
# would only be meaningful inside this run.
STG_SET_COLUMNS = [c for c in SET_COLUMNS if c[0] != "id"]
STG_CARD_COLUMNS = [c for c in CARD_COLUMNS if c[0] != "id"]
STG_PRINTING_COLUMNS = [c for c in PRINTING_COLUMNS if c[0] not in ("card_id", "set_id")] + [
    ("card_name", lit_str),
    ("set_code", lit_str),
]


def build_rows(cards_raw, sets_by_code, include_digital, include_tokens):
    """Turn raw Scryfall card objects into staging rows for each table.

    Mirrors generate_seed.build_dataset, but keyed naturally rather than by
    generated ids: cards are deduplicated by name (and by oracle_id, which the
    schema also requires to be unique), printings reference their card by name
    and their set by code, and only sets with a printing are emitted.
    """
    cards_rows: list[dict] = []
    printing_rows: list[dict] = []
    seen_names: set[str] = set()
    seen_oracle: set[str] = set()
    set_codes: list[str] = []
    processed = skipped = duplicate_oracle = 0

    for card in cards_raw:
        processed += 1
        if not is_real_card(card, include_digital, include_tokens):
            continue
        name, code, oracle_id = card.get("name"), card.get("set"), card.get("oracle_id")
        # cards.oracle_id is NOT NULL; a few odd layouts (e.g. reversible_card)
        # have no single top-level oracle_id, so skip them rather than emit a
        # row that would violate the constraint.
        if not name or not code or not oracle_id:
            skipped += 1
            continue

        if name not in seen_names:
            # Two names sharing an oracle_id would make the upsert hit the same
            # row twice ("cannot affect row a second time"); keep the first.
            if oracle_id in seen_oracle:
                duplicate_oracle += 1
                continue
            seen_names.add(name)
            seen_oracle.add(oracle_id)
            cards_rows.append(oracle_fields(card))

        if code not in set_codes:
            set_codes.append(code)

        printing = printing_fields(card)
        printing["card_name"] = name
        printing["set_code"] = code
        printing_rows.append(printing)

    # Printings of a skipped duplicate would have no card to join to.
    printing_rows = [p for p in printing_rows if p["card_name"] in seen_names]
    # set_fields wants an id; staging has no id column, so pass a throwaway.
    sets_rows = [set_fields(sets_by_code.get(code, {"code": code, "name": code}), 0) for code in set_codes]

    print(f"Processed {processed} card objects.", file=sys.stderr)
    for label, count in (("no name/set/oracle_id", skipped), ("a duplicate oracle_id", duplicate_oracle)):
        if count:
            print(f"  skipped {count} objects with {label}", file=sys.stderr)
    return sets_rows, cards_rows, printing_rows


def insert_batches(table: str, spec, rows):
    """Yield batched multi-row INSERTs loading ``rows`` into a staging table."""
    col_list = ", ".join(name for name, _ in spec)
    for start in range(0, len(rows), BATCH_SIZE):
        values = ",\n".join(
            "  (" + ", ".join(fmt(row.get(name)) for name, fmt in spec) + ")"
            for row in rows[start : start + BATCH_SIZE]
        )
        yield f"insert into {table} ({col_list}) values\n{values};\n"


def upsert(table: str, columns, conflict: str, source: str) -> str:
    """An INSERT ... ON CONFLICT that refreshes every non-key column."""
    names = [name for name, _ in columns]
    updates = ", ".join(f"{n} = excluded.{n}" for n in names if n != conflict)
    return (
        f"insert into {table} ({', '.join(names)})\n{source}\n"
        f"on conflict ({conflict}) do update set {updates};\n"
    )


def refresh_sql(sets_rows, cards_rows, printing_rows, prune: bool, dry_run: bool, force: bool = False):
    """Yield the whole refresh as one transaction's worth of SQL."""
    yield "begin;\n"

    # `with no data` copies the column layout only — no constraints, no
    # defaults — so staging can hold the surrogate id columns empty.
    for table in ("sets", "cards", "printings"):
        yield f"create temp table stg_{table} on commit drop as select * from {table} with no data;\n"
    yield "alter table stg_printings add column card_name varchar(255), add column set_code varchar(15);\n"

    for table, spec, rows in (
        ("stg_sets", STG_SET_COLUMNS, sets_rows),
        ("stg_cards", STG_CARD_COLUMNS, cards_rows),
        ("stg_printings", STG_PRINTING_COLUMNS, printing_rows),
    ):
        yield from insert_batches(table, spec, rows)
    yield "analyze stg_sets, stg_cards, stg_printings;\n"

    set_cols = ", ".join(name for name, _ in STG_SET_COLUMNS)
    yield "\\echo '-- sets'\n"
    yield upsert("sets", STG_SET_COLUMNS, "code", f"select {set_cols} from stg_sets")

    # Scryfall occasionally moves a card to a new oracle_id. Realign first so
    # the upsert updates that card in place (keeping its id, and the decks
    # pointing at it) instead of colliding on the unique name.
    yield (
        "update cards c set oracle_id = s.oracle_id from stg_cards s\n"
        " where s.name = c.name and s.oracle_id is distinct from c.oracle_id\n"
        "   and not exists (select 1 from cards o where o.oracle_id = s.oracle_id);\n"
    )
    # Scryfall also moves a name between oracle_ids — a card is renamed and the
    # previous holder of that name is retired (e.g. "No Way Out (Playtest)"
    # becoming plain "No Way Out"). cards.name is unique, so the row sitting on
    # the name has to release it before the upsert can claim it. Park it under a
    # unique placeholder: a row Scryfall still knows gets its real name back
    # from the upsert below, and one it has dropped keeps the marker until the
    # prune step deletes it — or, if a deck still references it, stays visible
    # as stale instead of silently taking the wrong card's name.
    yield (
        "update cards c set name = left(c.name, 230) || ' [stale #' || c.id || ']'\n"
        " where exists (select 1 from stg_cards s\n"
        "                where s.name = c.name and s.oracle_id is distinct from c.oracle_id);\n"
    )
    card_cols = ", ".join(name for name, _ in STG_CARD_COLUMNS)
    yield "\\echo '-- cards'\n"
    yield upsert("cards", STG_CARD_COLUMNS, "oracle_id", f"select {card_cols} from stg_cards")

    printing_select = ", ".join(
        {"card_id": "c.id", "set_id": "s.id"}.get(name, f"p.{name}") for name, _ in PRINTING_COLUMNS
    )
    yield "\\echo '-- printings'\n"
    yield upsert(
        "printings",
        PRINTING_COLUMNS,
        "id",
        f"select {printing_select}\n  from stg_printings p\n"
        "  join cards c on c.name = p.card_name\n  join sets s on s.code = p.set_code",
    )

    if prune:
        # Deleting a card or a set is expensive: the FK checks behind it scan
        # printings.card_id / printings.set_id / tournament_deck_cards.card_id,
        # none of which has an index the planner can use for the check, so each
        # deleted row costs a sequential scan. That is fine for the handful of
        # rows Scryfall genuinely retires, and ruinous for a large prune — which
        # in practice means the run's filters don't match how the data was
        # seeded (--exclude-tokens against a token-seeded database, a truncated
        # bulk export) rather than an upstream deletion. Stop before spending
        # hours narrowing the database to a slice of itself.
        if not force:
            yield (
                "do $$\n"
                "declare doomed_printings bigint; doomed_cards bigint; limit_pct constant int = 5;\n"
                "begin\n"
                "  select count(*) into doomed_printings from printings p\n"
                "   where not exists (select 1 from stg_printings s where s.id = p.id);\n"
                "  select count(*) into doomed_cards from cards c\n"
                "   where not exists (select 1 from stg_cards s where s.name = c.name);\n"
                "  if doomed_printings * 100 > limit_pct * greatest((select count(*) from printings), 1)\n"
                "     or doomed_cards * 100 > limit_pct * greatest((select count(*) from cards), 1) then\n"
                "    raise exception 'prune would delete % printings and % cards, past the %-percent limit',\n"
                "      doomed_printings, doomed_cards, limit_pct\n"
                "      using hint = 'Re-run with the same --include-digital/--exclude-tokens flags the data "
                "was loaded with, or pass --force to prune anyway (slow: each deleted row costs a sequential scan).';\n"
                "  end if;\n"
                "end $$;\n"
            )
        yield "\\echo '-- pruned printings (deck pins cleared, then rows deleted)'\n"
        # A pinned printing that no longer exists can't stay referenced.
        yield (
            "with cleared as (\n"
            "  update deck_cards d set printing_id = null\n"
            "   where d.printing_id is not null\n"
            "     and not exists (select 1 from stg_printings s where s.id = d.printing_id)\n"
            "  returning 1\n) select count(*) as deck_pins_cleared from cleared;\n"
        )
        yield (
            "with gone as (\n"
            "  delete from printings p\n"
            "   where not exists (select 1 from stg_printings s where s.id = p.id)\n"
            "  returning 1\n) select count(*) as printings_deleted from gone;\n"
        )
        yield "\\echo '-- pruned cards (only those nothing references)'\n"
        yield (
            "with gone as (\n"
            "  delete from cards c\n"
            "   where not exists (select 1 from printings p where p.card_id = c.id)\n"
            "     and not exists (select 1 from deck_cards d where d.card_id = c.id)\n"
            "     and not exists (select 1 from tournament_deck_cards t where t.card_id = c.id)\n"
            "  returning 1\n) select count(*) as cards_deleted from gone;\n"
        )
        yield (
            "select count(*) as cards_kept_still_referenced from cards c\n"
            " where not exists (select 1 from printings p where p.card_id = c.id);\n"
        )
        yield "\\echo '-- pruned sets (those left with no printings)'\n"
        yield (
            "with gone as (\n"
            "  delete from sets s\n"
            "   where not exists (select 1 from printings p where p.set_id = s.id)\n"
            "  returning 1\n) select count(*) as sets_deleted from gone;\n"
        )

    yield "\\echo '-- totals'\n"
    yield (
        "select (select count(*) from sets) as sets, (select count(*) from cards) as cards,\n"
        "       (select count(*) from printings) as printings;\n"
    )
    yield "rollback;\n" if dry_run else "commit;\n"
    if not dry_run:
        # Fresh statistics for the planner: the meta and search pages lean on
        # these tables and a bulk refresh invalidates the old estimates.
        yield "analyze sets, cards, printings;\n"


def apply_sql(statements, db_url: str) -> None:
    """Stream SQL into psql, so the full script never sits in memory."""
    proc = subprocess.Popen(
        ["psql", db_url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        stdin=subprocess.PIPE,
        text=True,
    )
    try:
        for chunk in statements:
            proc.stdin.write(chunk)
        proc.stdin.close()
    except BrokenPipeError:
        pass  # psql died early; its stderr already said why
    if proc.wait() != 0:
        sys.exit("psql failed; the transaction rolled back and the data is unchanged.")


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Refresh cards/sets/printings in place from Scryfall.")
    p.add_argument("--db-url", default=os.environ.get("DATABASE_URL", LOCAL_DB_URL), help="target DB (default: $DATABASE_URL or local)")
    p.add_argument("--bulk-type", default="default_cards", help="Scryfall bulk export to use (default: default_cards)")
    p.add_argument("--limit", type=int, default=None, help="only process the first N card objects (implies --no-prune)")
    p.add_argument("--include-digital", action="store_true", help="include digital-only printings (Alchemy/Arena)")
    p.add_argument("--exclude-tokens", dest="include_tokens", action="store_false", help="exclude token/emblem/art-series printings")
    p.add_argument("--no-prune", dest="prune", action="store_false", help="keep rows that are no longer in Scryfall")
    p.add_argument("--force", action="store_true", help="prune even when it would remove a large share of the table")
    p.add_argument("--dry-run", action="store_true", help="run the whole refresh, report counts, then roll back")
    return p.parse_args(argv)


def main(argv=None):
    load_env()  # before parse_args so a .env DATABASE_URL feeds the --db-url default
    args = parse_args(argv)

    sets_by_code = fetch_sets()
    cards_raw = iter_bulk_cards(args.bulk_type)
    prune = args.prune
    if args.limit is not None:
        cards_raw = itertools.islice(cards_raw, args.limit)
        if prune:
            # Everything outside the slice looks deleted; that isn't a refresh.
            print("--limit given: skipping the prune step.", file=sys.stderr)
            prune = False

    sets_rows, cards_rows, printing_rows = build_rows(
        cards_raw, sets_by_code, args.include_digital, args.include_tokens
    )
    print(
        f"Refreshing {args.db_url.rsplit('@', 1)[-1]}: {len(sets_rows)} sets, "
        f"{len(cards_rows)} cards, {len(printing_rows)} printings"
        f"{' (dry run)' if args.dry_run else ''}...",
        file=sys.stderr,
    )
    apply_sql(refresh_sql(sets_rows, cards_rows, printing_rows, prune, args.dry_run, args.force), args.db_url)
    print("Rolled back (dry run)." if args.dry_run else "Done.", file=sys.stderr)


if __name__ == "__main__":
    main()
