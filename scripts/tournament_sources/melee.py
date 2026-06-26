"""melee.gg published tournament decklists.

melee.gg has an official, credential-gated data API, but the decklists it
publishes are also reachable through the same public AJAX endpoints the site's
own pages call — no login — which is what we use here (mirroring the long-lived
community scrapers). Three endpoints, all returning either JSON or an HTML
fragment we pull a single attribute out of:

  POST /Decklist/TournamentSearch  — DataTables list of events in a date range
        -> {recordsTotal, data:[{ID, Name, StartDate, StatusDescription,
                                  FormatDescription, OrganizationName, Decklists}]}
  GET  /Tournament/View/{id}        — event page; we scrape the *completed* round
        buttons (`round-selector`, `data-is-completed="True"`) for their data-id
  POST /Standing/GetRoundStandings — DataTables standings for a round
        -> {recordsTotal, data:[{Rank, MatchWins/Losses/Draws,
                                  Team:{Players:[{DisplayName}]}, Decklists:[{DecklistId}]}]}
  GET  /Decklist/View/{id}          — deck page; the full list is server-rendered
        as plain text in <pre id="decklist-text"> (canonical " // " card names).

The final completed round's standings give every player's placement + record +
decklist id; we then fetch each top finisher's deck page for the card list. Only
decks we can read cards for are emitted (placement-only rows add no meta signal);
``player_count`` still reflects the full standings. Stdlib only.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta
from html import unescape

from .base import Deck, DeckCard, Tournament, http_get, http_post, log

name = "melee"

LIST_URL = "https://melee.gg/Decklist/TournamentSearch"
EVENT_URL = "https://melee.gg/Tournament/View/{id}"
STANDINGS_URL = "https://melee.gg/Standing/GetRoundStandings"
DECK_URL = "https://melee.gg/Decklist/View/{id}"

PAGE = 25  # DataTables page size both POST endpoints expect
MAX_DECKS = 64  # deck pages fetched per event (top finishers); standings are rank-ordered
DEFAULT_DAYS = 7  # window when --since is omitted
# melee marks events "Ended" lazily; treat anything older than this as ended too.
ENDED_AFTER_DAYS = 5
# melee 403s our default UA; identify as a browser like the public site's own AJAX.
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"}

# melee FormatDescription -> formats.code. Lowercased before lookup; an unmapped
# value yields NULL (the FK is nullable) rather than dropping the event.
FORMATS = {
    "standard": "standard",
    "pioneer": "pioneer",
    "modern": "modern",
    "legacy": "legacy",
    "vintage": "vintage",
    "pauper": "pauper",
    "premodern": "premodern",
    "old school": "oldschool",
    "oldschool": "oldschool",
    "historic": "historic",
    "alchemy": "alchemy",
    "timeless": "timeless",
    "gladiator": "gladiator",
    "penny dreadful": "penny",
    "commander": "commander",
    "commander / edh": "commander",
    "edh": "commander",
    "duel commander": "duel",
    "pauper edh": "paupercommander",
    "pauper commander": "paupercommander",
    "oathbreaker": "oathbreaker",
}

LIST_COLUMNS = ["ID", "Name", "StartDate", "Status", "Format", "OrganizationName", "Decklists"]
STANDING_COLUMNS = ["Rank", "Player", "Decklists", "MatchRecord", "GameRecord", "Points"]

_ROUND_RE = re.compile(r"<button[^>]*\bround-selector\b[^>]*>")
# The deck page server-renders the plain-text list into <pre id="decklist-text">,
# using the canonical " // " name for split/DFC cards (the page's copy buttons
# read from it; the visible card grid is hydrated client-side via JS instead).
_DECKTEXT_RE = re.compile(r'id="decklist-text"[^>]*>(.*?)</pre>', re.S)
# Authoritative format lives in the event page's pipe-delimited headline
# ("... | Format: Modern | ..."), not the (often stale) list FormatDescription.
_FORMAT_RE = re.compile(r"Format:\s*([^|<,]+)")


def _attr(tag: str, attr: str) -> str | None:
    m = re.search(rf'{attr}="([^"]*)"', tag)
    return m.group(1) if m else None


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _format(label: str | None) -> str | None:
    label = (label or "").split(",")[0].strip().lower()  # multi-format events: take the first
    return FORMATS.get(label)


def _datatables(columns: list[str], order_col: int, order_dir: str, start: int, **extra) -> dict:
    """Build the server-side DataTables form params these endpoints bind to."""
    p = {
        "draw": "1",
        "start": str(start),
        "length": str(PAGE),
        "search[value]": "",
        "search[regex]": "false",
        "order[0][column]": str(order_col),
        "order[0][dir]": order_dir,
    }
    for i, c in enumerate(columns):
        p[f"columns[{i}][data]"] = c
        p[f"columns[{i}][name]"] = c
        p[f"columns[{i}][searchable]"] = "true"
        p[f"columns[{i}][orderable]"] = "true"
        p[f"columns[{i}][search][value]"] = ""
        p[f"columns[{i}][search][regex]"] = "false"
    p.update(extra)
    return p


def _list_events(start: date, end: date) -> list[dict]:
    """Every event with published decklists in [start, end], newest first."""
    out, offset, total = [], 0, 1
    today = date.today()
    while offset < total:
        params = _datatables(
            LIST_COLUMNS, 2, "desc", offset,
            q="",
            startDate=f"{start.isoformat()}T00:00:00.000Z",
            endDate=f"{end.isoformat()}T23:59:59.999Z",
        )
        page = json.loads(http_post(LIST_URL, params, headers=HEADERS))
        total = page.get("recordsTotal", 0)
        rows = page.get("data") or []
        if not rows:
            break
        offset += len(rows)
        for r in rows:
            held = (r.get("StartDate") or "")[:10]
            ended = r.get("StatusDescription") == "Ended"
            old = held and date.fromisoformat(held) <= today - timedelta(days=ENDED_AFTER_DAYS)
            if (r.get("Decklists") or 0) and (ended or old):
                out.append(r)
    return out


def _round_ids(html: str) -> list[str]:
    """data-id of each completed round button, in chronological (page) order."""
    ids = []
    for tag in _ROUND_RE.findall(html):
        if _attr(tag, "data-is-completed") == "True":
            rid = _attr(tag, "data-id")
            if rid:
                ids.append(rid)
    return ids


def _standings(round_ids: list[str]) -> tuple[list[dict], int]:
    """Standings of the last completed round that has any, with the total entry count.

    A just-closed final round can briefly publish no rows; fall back to the
    previous round so the event still imports.
    """
    for rid in reversed(round_ids):
        rows, total, offset = [], 0, 0
        while True:
            params = _datatables(STANDING_COLUMNS, 0, "asc", offset, roundId=rid)
            page = json.loads(http_post(STANDINGS_URL, params, headers=HEADERS))
            total = page.get("recordsTotal", total)
            data = page.get("data") or []
            if not data:
                break
            rows.extend(data)
            offset += len(data)
            if offset >= total:
                break
        if rows:
            return rows, total
    return [], 0


def _deck_cards(deck_id: str) -> list[DeckCard]:
    """Parse a deck page's plain-text list into card entries.

    The list is sectioned by "MainDeck"/"Sideboard"/"Commander"/"Companion"
    headers; a Companion is also listed under Sideboard, so its own section is
    skipped to avoid double-counting.
    """
    html = http_get(DECK_URL.format(id=deck_id), fatal=False, headers=HEADERS)
    m = _DECKTEXT_RE.search(html or "")
    if not m:
        return []
    boards = {"maindeck": "main", "deck": "main", "sideboard": "side",
              "commander": "commander", "companion": "companion"}
    board, cards = "main", []
    for line in unescape(m.group(1)).replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.lower() in boards:
            board = boards[line.lower()]
            continue
        entry = re.match(r"(\d+)\s+(.+)", line)
        if entry and board != "companion":
            cards.append(DeckCard(entry.group(2).strip(), int(entry.group(1)), board))
    return cards


def fetch(since: date | None):
    """Yield melee.gg events held on/after ``since`` (default: the last week)."""
    today = date.today()
    start = since or today - timedelta(days=DEFAULT_DAYS)
    events = _list_events(start, today)
    log(f"  {len(events)} ended events with decklists in {start.isoformat()}..{today.isoformat()}")

    for i, ev in enumerate(events, 1):
        tid = str(ev["ID"])
        name_ = re.sub(r"\s+", " ", ev.get("Name") or tid).strip()
        print(f"\r    [{i}/{len(events)}] {tid} {name_}", end="", file=sys.stderr, flush=True)

        page = http_get(EVENT_URL.format(id=tid), headers=HEADERS)
        entries, total = _standings(_round_ids(page))

        decks = []
        for e in entries:
            if len(decks) >= MAX_DECKS:
                break
            dls = e.get("Decklists") or []
            deck_id = next((d.get("DecklistId") for d in dls if d.get("DecklistId")), None)
            if not deck_id:
                continue
            cards = _deck_cards(deck_id)
            if not cards:
                continue
            players = e.get("Team", {}).get("Players") or [{}]
            decks.append(
                Deck(
                    player=re.sub(r"\s+", " ", players[0].get("DisplayName") or "Unknown").strip(),
                    placement=_int(e.get("Rank")),
                    wins=_int(e.get("MatchWins")),
                    losses=_int(e.get("MatchLosses")),
                    draws=_int(e.get("MatchDraws")),
                    cards=cards,
                )
            )

        if not decks:
            continue
        print(f"\r    [{i}/{len(events)}] {tid} {name_} — {len(decks)} decks", file=sys.stderr)
        yield Tournament(
            source=name,
            external_id=tid,
            name=name_,
            format=_format(m.group(1)) if (m := _FORMAT_RE.search(page)) else None,
            held_on=(ev.get("StartDate") or "")[:10] or None,
            location=re.sub(r"\s+", " ", ev.get("OrganizationName") or "").strip() or "Online",
            source_url=EVENT_URL.format(id=tid),
            player_count=total or None,
            decks=decks,
        )
    print(file=sys.stderr)  # terminate the in-place counter line
