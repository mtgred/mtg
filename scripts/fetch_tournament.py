#!/usr/bin/env python3
"""Fetch one mtgdecks.net tournament: every decklist plus each deck's record.

    python scripts/fetch_tournament.py https://mtgdecks.net/Premodern/agroliga-live-in-valdepenas-asociacion-conclave-manzanares-tournament-265368
    python scripts/fetch_tournament.py <url> --summary
    python scripts/fetch_tournament.py <url> -o event.json

Prints the event as JSON on stdout — the same shape scripts/ingest_tournaments.py
caches, so it pipes or saves as-is — or, with ``--summary``, the standings table.
Read-only: nothing here touches the database; use ingest_tournaments.py for that.

Parsing lives in tournament_sources/mtgdecks.py. Each deck is a separate page
fetch and mtgdecks meters them per IP, so a large event takes minutes (a 429
backoff is logged and honored rather than failing).

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tournament_sources import Tournament, mtgdecks  # noqa: E402


def summary(t: Tournament) -> str:
    """Standings as a plain table: placement, player, record, archetype, cards."""
    lines = [
        f"{t.name} — {t.format or '?'} — {t.held_on or '?'} — {t.player_count or len(t.decks)} players",
        t.source_url or "",
    ]
    for d in t.decks:
        record = "-".join(str(n) for n in (d.wins, d.losses, d.draws) if n is not None) or "?"
        cards = sum(c.quantity for c in d.cards)
        lines.append(f"{d.placement or '?':>4}  {d.player:<24} {record:<9} {d.archetype or '':<28} {cards:>3} cards")
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("url", help="mtgdecks.net tournament URL")
    p.add_argument("--summary", action="store_true", help="print the standings table instead of JSON")
    p.add_argument("-o", "--output", type=Path, help="write to this file instead of stdout")
    args = p.parse_args(argv)

    t = mtgdecks.fetch_url(args.url)
    out = summary(t) if args.summary else json.dumps(asdict(t), indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(out + "\n", encoding="utf-8")
        print(f"Wrote {args.output} — {len(t.decks)} decks", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
