"""Magic Online (mtgo.com) published decklists.

MTGO posts results at https://www.mtgo.com/decklists/<YYYY>/<MM>, one page per
event. Each event page embeds the full result as a JSON object assigned to
``window.MTGO.decklists.data``. There are two shapes, both handled here:

Challenges/Showcases (the original shape):
  event_id, description, starttime, format (e.g. "CMODERN"), player_count,
  decklists[]  — {loginid, player, main_deck[], sideboard_deck[]}
  winloss[]    — {loginid, wins, losses}
  standings[]  — {loginid, rank, ...}      (Swiss standings)
  final_rank[] — {loginid, rank, ...}      (top-8 playoff finish; challenges only)

Leagues (newer shape, no format code or standings):
  playeventid, instance_id (id + date), name, publish_date,
  decklists[]  — {loginid, player, wins: {wins, losses}, main_deck[], sideboard_deck[]}

Either shape's cards are {qty, card_attributes: {card_name, ...}}. Brand-new
events sometimes render only brackets/standings with no ``decklists`` key yet;
those are skipped until the lists are posted.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta

from .base import Deck, DeckCard, Tournament, http_get, log

INDEX_URL = "https://www.mtgo.com/decklists/{year:04d}/{month:02d}"
EVENT_URL = "https://www.mtgo.com/decklist/{slug}"

# MTGO format codes -> formats.code. Unknown codes fall back to None (the
# tournaments.format FK is nullable), so a new format won't break ingestion.
FORMATS = {
    "CSTANDARD": "standard",
    "CPIONEER": "pioneer",
    "CMODERN": "modern",
    "CLEGACY": "legacy",
    "CVINTAGE": "vintage",
    "CPAUPER": "pauper",
    "CPREMODERN": "premodern",
    "CPENNY": "penny",
    "CDC": "duel",
    "CDUELCOMMANDER": "duel",
}

# League pages no longer carry a format code, only an event name ("Legacy
# League"). Matched in order so multi-word/substring names resolve correctly
# (premodern before modern, duel commander before any "commander").
NAME_FORMATS = [
    ("premodern", "premodern"),
    ("duel commander", "duel"),
    ("pauper", "pauper"),
    ("penny", "penny"),
    ("standard", "standard"),
    ("pioneer", "pioneer"),
    ("modern", "modern"),
    ("legacy", "legacy"),
    ("vintage", "vintage"),
]

name = "mtgo"


def _format(data: dict) -> str | None:
    code = (data.get("format") or "").upper()
    if code in FORMATS:
        return FORMATS[code]
    label = (data.get("description") or data.get("name") or "").lower()
    return next((fmt for kw, fmt in NAME_FORMATS if kw in label), None)


def _event_slugs(year: int, month: int) -> list[str]:
    """Slugs of every event listed on a monthly index page, newest first."""
    html = http_get(INDEX_URL.format(year=year, month=month))
    seen: dict[str, None] = {}  # dict preserves order, dedupes repeated links
    needle = 'href="/decklist/'
    i = html.find(needle)
    while i != -1:
        start = i + len(needle)
        end = html.find('"', start)
        seen.setdefault(html[start:end], None)
        i = html.find(needle, end)
    return list(seen)


def _event_data(slug: str) -> dict | None:
    """Parse the ``window.MTGO.decklists.data`` object from an event page."""
    html = http_get(EVENT_URL.format(slug=slug))
    anchor = html.find("window.MTGO.decklists.data")
    if anchor == -1:
        return None
    i = html.index("=", anchor) + 1
    # Brace-match the object literal (values contain no nested braces in strings
    # that would unbalance, so a simple depth counter is sufficient here).
    depth = 0
    for j in range(i, len(html)):
        ch = html[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(html[i : j + 1])
    return None


def _cards(entries: list[dict], board: str) -> list[DeckCard]:
    out = []
    for e in entries or []:
        attrs = e.get("card_attributes") or {}
        cname = attrs.get("card_name")
        if cname:
            out.append(DeckCard(cname, int(e.get("qty", 1)), board))
    return out


def _decks(data: dict) -> list[Deck]:
    # Index the per-player result tables by loginid so we can attach
    # placement/record to each decklist.
    wl = {w["loginid"]: w for w in data.get("winloss") or []}
    rank = {r["loginid"]: r for r in data.get("final_rank") or []}
    rank.update({s["loginid"]: rank.get(s["loginid"], s) for s in data.get("standings") or []})

    decks = []
    for d in data.get("decklists") or []:
        lid = d.get("loginid")
        # Challenges expose records in a top-level winloss[] table; leagues
        # embed the record per deck as a {wins, losses} object.
        rec = wl.get(lid) or (d["wins"] if isinstance(d.get("wins"), dict) else {})
        decks.append(
            Deck(
                player=d.get("player") or "Unknown",
                placement=int(rank[lid]["rank"]) if lid in rank else None,
                wins=int(rec["wins"]) if "wins" in rec else None,
                losses=int(rec["losses"]) if "losses" in rec else None,
                cards=_cards(d.get("main_deck"), "main") + _cards(d.get("sideboard_deck"), "side"),
            )
        )
    return decks


def _player_count(data: dict) -> int | None:
    pc = data.get("player_count")
    if isinstance(pc, dict):
        pc = pc.get("players")
    return int(pc) if pc not in (None, "") else None


def fetch(since: date | None):
    """Yield published MTGO events from ``since``'s month through today."""
    today = date.today()
    cursor = (since or today.replace(day=1)).replace(day=1)
    months = []
    while cursor <= today:
        months.append((cursor.year, cursor.month))
        cursor = (cursor.replace(day=28) + timedelta(days=7)).replace(day=1)

    for year, month in months:
        slugs = _event_slugs(year, month)
        # Each slug is a separate page fetch (hundreds per active month), so emit
        # a live counter — otherwise the scan looks hung for minutes.
        log(f"  {year}-{month:02d}: {len(slugs)} event pages")
        for i, slug in enumerate(slugs, 1):
            print(f"\r    scanning {i}/{len(slugs)}", end="", file=sys.stderr, flush=True)
            data = _event_data(slug)
            if not data or not data.get("decklists"):
                continue  # not published yet, or a brackets-only stub
            held = (data.get("starttime") or data.get("publish_date") or "")[:10] or None
            if since and held and held < since.isoformat():
                continue
            print(f"\r    [{i}/{len(slugs)}] {slug} — {len(data['decklists'])} decks", file=sys.stderr)
            yield Tournament(
                source=name,
                # Challenges key on event_id; leagues reuse a playeventid every
                # week, so instance_id (id + date) is their stable per-run key.
                external_id=str(data.get("event_id") or data.get("instance_id")),
                name=data.get("description") or data.get("name") or slug,
                format=_format(data),
                held_on=held,
                location="Online",
                source_url=EVENT_URL.format(slug=slug),
                player_count=_player_count(data),
                decks=_decks(data),
            )
        print(file=sys.stderr)  # terminate the in-place counter line
