# Manaring

A Magic: The Gathering card / set / deck browser. A React SPA talks directly to
Supabase Postgres (no application API layer for reads or writes); access control
is entirely Row-Level Security. Card data originates from Scryfall, loaded as a
committed seed.

## Layout

- `frontend/` — React 19 + Vite SPA (the actual app). Package manager: **bun**.
- `supabase/` — local Supabase project: declarative schema, ordered seeds, config.
- `scripts/` — stdlib-only Python data tooling (no dependencies):
  - `generate_seed.py` — fetches Scryfall data into `supabase/seed.sql`.
  - `ingest_tournaments.py` — ingests competitive results (see below).
  - `delete_tournament.py` — removes a tournament everywhere it's stored (see below).
  - `ingest_goatbots_prices.py` — refreshes MTGO prices from Goatbots (see below).

## Getting started

```bash
# 1. Boot the local Supabase stack (requires the Supabase CLI + Docker)
supabase start

# 2. Build the DB from schemas/* and load every seed
supabase db reset

# 3. Wire the frontend to the local stack — copy the URL + anon key into
#    frontend/.env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
supabase status

# 4. Run the app
cd frontend && bun install && bun run dev   # http://localhost:3000
```

`supabase db reset` rebuilds everything from `supabase/schemas/*` and `supabase/seeds/*`
(both ordered in `supabase/config.toml`). Re-run it after editing any schema or seed —
changes are not applied live.

## Tournament ingestion

`scripts/ingest_tournaments.py` pulls competitive results from external sources
(currently `mtgo`, `melee`, `mtgdecks`, and `topdeck`), normalizes them, and
upserts them into the database. The `topdeck` source uses topdeck.gg's free API
and needs `TOPDECK_API_KEY` (get a key at <https://topdeck.gg/developers>) — set
it in the environment or put `TOPDECK_API_KEY=...` in a gitignored `.env` file
at the repo root, which the script loads; without it that source is skipped
with a notice. The same command works locally and in production — only the target
connection string differs.

The pipeline is **idempotent**: events are keyed on `(source, external_id)`, and
each event's decks are rebuilt from scratch on every run, so re-importing
converges instead of duplicating. Each event is applied in its own transaction
the moment it's fetched, so an interrupted run keeps everything ingested so far.
Card names are resolved against the `cards` table (handling split / double-faced
spellings); a name with no matching row is reported and skipped, same as the
curated seed.

### Common usage

```bash
# Ingest everything into the local DB (default target)
python scripts/ingest_tournaments.py

# A single source, only recent events
python scripts/ingest_tournaments.py --source mtgo --since 2026-01-01

# Only Modern events (repeat --format for several formats)
python scripts/ingest_tournaments.py --format modern

# Preview the generated SQL without touching the DB
python scripts/ingest_tournaments.py --dry-run

# Production — same command, different target
DATABASE_URL="$SUPABASE_DB_URL" python scripts/ingest_tournaments.py --source mtgo
```

DB access is delegated to the `psql` CLI (already required by the Supabase
workflow), so there is no driver dependency. The default target is the local
Supabase database; override it with `--db-url` or the `DATABASE_URL` env var.

### Options

| Option | Description |
| --- | --- |
| `--source NAME` | Source(s) to ingest; repeatable. Default: all (`mtgo`, `melee`, `mtgdecks`, `topdeck`, `spellbinder`). |
| `--format CODE` | Only events matching this `formats.code` (e.g. `modern`); repeatable. Default: all. Events with no format are excluded when set. |
| `--since YYYY-MM-DD` | Only events held on or after this date. |
| `--db-url URL` | Target database. Default: `$DATABASE_URL` or the local Supabase DB. |
| `--snapshot` | Also write the generated SQL to `supabase/seeds/tournaments.sql`. |
| `--from-cache` | Re-ingest from `scripts/_tournament_cache/` instead of the network. |
| `--no-cache` | Don't write fetched data to the cache. |
| `--cache-dir PATH` | Cache location. Default: `scripts/_tournament_cache/`. |
| `--dry-run` | Print the SQL instead of applying it. |

### Disk cache — reload fast after `supabase db reset`

Fetching from the network is the slow part, so every fetch is cached to
`scripts/_tournament_cache/<source>.json` (gitignored). The cache is **merged**
by `(source, external_id)`, so incremental `--since` fetches accumulate into a
growing local archive rather than overwriting it.

`--from-cache` re-ingests from those files instead of hitting the network — the
fast way to repopulate the database after a `supabase db reset` without
re-downloading every event:

```bash
# First run: fetches from the network, applies to the DB, and caches to disk
python scripts/ingest_tournaments.py --source mtgo

# After `supabase db reset`: reload from disk, no re-download
python scripts/ingest_tournaments.py --source mtgo --from-cache
```

`--from-cache` still honors `--since`, and composes with `--dry-run` and
`--snapshot`. Use `--no-cache` to skip writing the cache, or `--cache-dir` to
change its location.

### Committed seed snapshot

`--snapshot` additionally writes the generated SQL to
`supabase/seeds/tournaments.sql`, the committed fixture that `supabase db reset`
loads automatically. This keeps the checked-in tournament data in sync with what
you ingested locally:

```bash
python scripts/ingest_tournaments.py --snapshot
```

In short: the **cache** (`_tournament_cache/`, gitignored) stores the raw fetched
source data so you can re-run ingestion offline, while the **snapshot**
(`supabase/seeds/tournaments.sql`, committed) is the SQL that `supabase db reset`
reloads automatically.

### Deleting a tournament

A bogus event — a duplicate, a junk import, something filed under the wrong
format — is stored in three places, and clearing only the database means it
walks straight back in on the next `supabase db reset`. `scripts/delete_tournament.py`
handles all three: the `tournaments` row (whose `ON DELETE CASCADE` foreign keys
take its decks and deck cards with it), the event's block in the committed
`supabase/seeds/tournaments.sql`, and its entry in the disk cache.

Targets are either the id in the app's URL (`…/tournaments/30`) or the stable
`source/external_id` identity, which — unlike the serial id — survives a reseed:

```bash
# Preview what would go, changing nothing
python scripts/delete_tournament.py 30 --dry-run

# Delete it (prompts for confirmation; -y skips the prompt)
python scripts/delete_tournament.py 30

# By source identity, and several at once
python scripts/delete_tournament.py spellbinder/2921762 -y
python scripts/delete_tournament.py 30 31 spellbinder/2921839

# Production — same command, different target
DATABASE_URL="$SUPABASE_DB_URL" python scripts/delete_tournament.py 30
```

Each matching event is printed with its deck and deck-card counts before
anything is deleted. Given a `source/external_id` that's already gone from the
database, the script still purges the seed and cache — precisely the state that
would otherwise resurrect it.

| Option | Description |
| --- | --- |
| `--dry-run` | Report what would be deleted; change nothing. |
| `-y`, `--yes` | Skip the confirmation prompt. |
| `--keep-seed` | Leave `supabase/seeds/tournaments.sql` alone. |
| `--keep-cache` | Leave `scripts/_tournament_cache/` alone. |
| `--db-url URL` | Target database. Default: `$DATABASE_URL` or the local Supabase DB. |
| `--cache-dir PATH` | Cache location. Default: `scripts/_tournament_cache/`. |

This does not stop a later `ingest_tournaments.py` run from re-fetching the
event from its source; for that it has to be filtered out at ingest time.

### Adding a source

Create a module under `scripts/tournament_sources/` exposing a module-level
`name` and a `fetch(since)` generator that yields normalized `Tournament`
objects (see `mtgo.py` and `base.py`), then register it in `SOURCES` in
`tournament_sources/__init__.py`. Nothing downstream — name resolution, SQL
generation, caching, snapshotting — needs to change.

## MTGO prices (Goatbots)

The MTGO mode of the deck price view prices each card at its **lowest
[Goatbots](https://www.goatbots.com) sell price** across all of the card's MTGO
versions (every printing, foil and nonfoil) — the same headline price a
goatbots.com card page shows. Cards Goatbots doesn't stock fall back to the
default printing's Scryfall `tix`.

`scripts/ingest_goatbots_prices.py` downloads Goatbots' daily bulk price file
(linked from <https://www.goatbots.com/download-prices>; MTGO catalog id → sell
price in tix) and rewrites the `goatbots_prices` table in one transaction, so
re-running it is idempotent. The frontend reads the `card_mtgo_prices` view,
which joins those ids against `printings.mtgo_id` / `mtgo_foil_id` and takes the
per-card minimum.

```bash
# Refresh prices in the local DB
python scripts/ingest_goatbots_prices.py

# Also rewrite the seed fixture that `supabase db reset` reloads
python scripts/ingest_goatbots_prices.py --snapshot

# Preview the SQL / target production
python scripts/ingest_goatbots_prices.py --dry-run
DATABASE_URL="$SUPABASE_DB_URL" python scripts/ingest_goatbots_prices.py
```

Like tournament ingestion, `--snapshot` writes the seed
(`supabase/seeds/goatbots_prices.sql`) that `supabase db reset` loads; it's
listed as a glob in `config.toml`, so a reset also works when the file is
absent. Note: Goatbots sits behind Cloudflare, which rejects curl's TLS
fingerprint but passes Python `urllib` with a descriptive User-Agent — use the
script rather than curl.

## Seed regeneration

`python scripts/generate_seed.py` rewrites `supabase/seed.sql` from Scryfall (a
large, gitignored file). Flags: `--limit`, `--include-digital`,
`--exclude-tokens`, `--output`.
