"""topdeck.gg tournament results (paper events; the de-facto home of cEDH).

topdeck.gg has a free, documented JSON API (https://topdeck.gg/docs/tournaments-v2):
one POST to /api/v2/tournaments per game+format returns every *completed* event
in a date window together with full standings and decklists — no per-deck
fetches. It requires an API key (free, from https://topdeck.gg/developers);
set TOPDECK_API_KEY. Without the key this source logs a notice and yields
nothing, so a default all-sources run still works.

Standings are placement-ordered. Decklists arrive as structured ``deckObj``
sections when the organizer's software captured them, else as plain text
sectioned by "~~Mainboard~~"-style headers (occasionally double-escaped with
literal ``\\n``, which is undone). A list that is just a URL, or hidden by the
organizer, parses to no cards — that deck is skipped, and events with no
parseable decks are skipped entirely.

Set TOPDECK_FORMATS to a comma-separated list of the site's format names
(e.g. "Premodern,EDH") to narrow a run. Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timezone

from .base import Deck, DeckCard, Tournament, http_post, log

name = "topdeck"

API_URL = "https://topdeck.gg/api/v2/tournaments"
BRACKET_URL = "https://topdeck.gg/bracket/{tid}"
GAME = "Magic: The Gathering"
DEFAULT_DAYS = 7  # window when --since is omitted
MAX_DECKS = 64  # decks kept per event (standings are placement-ordered), matching the other sources

# topdeck format name (case-sensitive, per the API docs) -> formats.code
FORMATS = {
    "Standard": "standard",
    "Pioneer": "pioneer",
    "Modern": "modern",
    "Legacy": "legacy",
    "Vintage": "vintage",
    "Pauper": "pauper",
    "Premodern": "premodern",
    "Old School 93/94": "oldschool",
    "EDH": "commander",
    "Pauper EDH": "paupercommander",
    "Duel Commander": "duel",
    "Oathbreaker": "oathbreaker",
    "Timeless": "timeless",
    "Historic": "historic",
}

# Decklist section header -> board. A Companion is also listed in the
# sideboard, so its own section is skipped (None), as in the other sources.
BOARDS = {"mainboard": "main", "maindeck": "main", "deck": "main", "sideboard": "side",
          "commanders": "commander", "commander": "commander", "companions": None, "companion": None}


def _cards_from_obj(obj: dict) -> list[DeckCard]:
    """Structured ``deckObj``: {"Mainboard": {"Card Name": {"count": 4, ...}}, ...}
    (tolerating a bare int where a count object is expected)."""
    cards = []
    for section, entries in obj.items():
        board = BOARDS.get(section.lower())
        if not board or not isinstance(entries, dict):
            continue
        for card_name, v in entries.items():
            qty = v.get("count", v.get("quantity")) if isinstance(v, dict) else v
            if isinstance(qty, int) and qty > 0:
                cards.append(DeckCard(card_name.strip(), qty, board))
    return cards


def _cards_from_text(text: str) -> list[DeckCard]:
    """Plain-text list sectioned by "~~Mainboard~~" headers; a bare URL yields []."""
    text = text.replace("\\n", "\n").replace("\\'", "'")  # some lists arrive with literal escapes
    board, cards = "main", []
    for line in text.splitlines():
        line = line.strip()
        if m := re.fullmatch(r"~~\s*(.+?)\s*~~", line):
            board = BOARDS.get(m.group(1).lower())
            continue
        entry = re.match(r"(\d+)\s+(.+)", line)
        if entry and board:
            cards.append(DeckCard(entry.group(2).strip(), int(entry.group(1)), board))
    return cards


def _decks(standings: list[dict]) -> list[Deck]:
    decks = []
    for placement, s in enumerate(standings[:MAX_DECKS], 1):
        obj = s.get("deckObj")
        cards = _cards_from_obj(obj) if isinstance(obj, dict) else _cards_from_text(s.get("decklist") or "")
        if not cards:
            continue
        decks.append(
            Deck(
                player=re.sub(r"\s+", " ", s.get("name") or "Unknown").strip(),
                placement=s.get("standing") or placement,
                wins=s.get("wins"),
                losses=s.get("losses"),
                draws=s.get("draws"),
                cards=cards,
            )
        )
    return decks


def fetch(since: date | None, formats: set[str] | None = None):
    """Yield topdeck.gg events held on/after ``since`` (default: the last week).

    ``formats`` is ignored (discovered per event); the caller filters the stream.
    """
    key = os.environ.get("TOPDECK_API_KEY")
    if not key:
        log("  TOPDECK_API_KEY not set — skipping topdeck (free key: https://topdeck.gg/developers)")
        return
    env = os.environ.get("TOPDECK_FORMATS")
    fmts = [f.strip() for f in env.split(",")] if env else list(FORMATS)
    unknown = [f for f in fmts if f not in FORMATS]
    if unknown:
        raise SystemExit(f"TOPDECK_FORMATS: unknown format(s) {unknown}; known: {', '.join(FORMATS)}")

    window = (
        {"start": int(datetime.combine(since, datetime.min.time(), tzinfo=timezone.utc).timestamp())}
        if since
        else {"last": DEFAULT_DAYS}
    )
    for fmt in fmts:
        body = {"game": GAME, "format": fmt, **window, "columns": ["name", "decklist", "wins", "draws", "losses"]}
        events = json.loads(http_post(API_URL, body, headers={"Authorization": key}, as_json=True))
        kept = 0
        for ev in events:
            standings = ev.get("standings") or []
            decks = _decks(standings)
            if not decks:
                continue
            kept += 1
            held = ev.get("startDate")
            place = ev.get("eventData") or {}
            yield Tournament(
                source=name,
                external_id=ev["TID"],
                name=re.sub(r"\s+", " ", ev.get("tournamentName") or ev["TID"]).strip(),
                format=FORMATS[fmt],
                held_on=datetime.fromtimestamp(held, tz=timezone.utc).date().isoformat() if held else None,
                location=", ".join(p for p in (place.get("city"), place.get("state")) if p) or None,
                source_url=BRACKET_URL.format(tid=ev["TID"]),
                player_count=len(standings) or None,
                decks=decks,
            )
        log(f"  {fmt}: {kept} of {len(events)} events had decklists")
