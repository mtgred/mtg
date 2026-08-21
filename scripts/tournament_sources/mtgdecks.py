"""mtgdecks.net tournament results.

mtgdecks.net aggregates paper + online events per format at
https://mtgdecks.net/<Format>/tournaments (server-rendered HTML, date-desc,
``page:N`` pagination). Each row links an event page whose standings table
gives rank, record, archetype, player and a deck link; each deck page embeds
the full list as plain text in ``<textarea id="arena_deck">`` (sectioned by
"Commander"/"Deck"/"Sideboard").

Cloudflare fronts the site and *challenges browser User-Agents* it can't
fingerprint, but the honest non-browser UA in base.HEADERS passes — so plain
stdlib fetching works; don't "upgrade" the UA to look like Chrome. Deck pages
are additionally metered per IP: sustained fetching trips 429s whose
Retry-After (~12-minute windows) base._request honors, so wide windows or many
formats don't fail — they just take correspondingly long.

Events shown with the MTGO platform icon are re-posts of mtgo.com results the
``mtgo`` source already ingests natively, so they're skipped here to avoid
duplicate tournaments.

By default every format in ``FORMATS`` is scanned; set MTGDECKS_FORMATS to a
comma-separated list of site paths (e.g. "Premodern,Legacy") to narrow a run.

List rows only show day-month; the year is inferred as the most recent
plausible one, which makes the pagination cutoff reliable for ``--since``
windows under ~11 months (the true ``held_on`` always comes from the event
page). Stdlib only.
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from html import unescape

from .base import Deck, DeckCard, Tournament, http_get, log

name = "mtgdecks"

BASE = "https://mtgdecks.net"
LIST_URL = BASE + "/{path}/tournaments/page:{page}"

# site URL path -> formats.code
FORMATS = {
    "Standard": "standard",
    "Pioneer": "pioneer",
    "Modern": "modern",
    "Legacy": "legacy",
    "Vintage": "vintage",
    "Pauper": "pauper",
    "Premodern": "premodern",
    "Old-school": "oldschool",
    "Commander": "commander",
    "Duel-Commander": "duel",
    "Alchemy": "alchemy",
    "Historic": "historic",
    "Timeless": "timeless",
}

DEFAULT_DAYS = 7  # window when --since is omitted
MAX_PAGES = 40  # safety cap per format (each page lists ~20 events)
DELAY = 1.2  # seconds between requests: the site 429s sustained bursts faster than ~1/s

_ROW_RE = re.compile(r"<tr[^>]*>.*?</tr>", re.S)
_EVENT_LINK_RE = re.compile(r'href="(/[^"]+-tournament-(\d+))"')
_DECK_LINK_RE = re.compile(r'href="(/[^"]+-decklist-[^"]+?-(\d+))"')
_LIST_DATE_RE = re.compile(r"<strong>(\d{1,2}-[A-Za-z]{3})</strong>")
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
_HELD_RE = re.compile(r"Tournament \|\s*(\d{4}-\d{2}-\d{2})")
_PLAYERS_RE = re.compile(r">\s*(\d+) Players\s*<")
_RANK_RE = re.compile(r"<td><strong>\s*(\d+)(?:st|nd|rd|th)\b")
_RECORD_RE = re.compile(r"\((\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?\)")
_ARCHETYPE_RE = re.compile(r'<td class="hidden-xs">\s*<span class="small">([^<]*)</span>')
_PLAYER_RE = re.compile(r'class="text-capitalize">\s*by\s+(.*?)\s*</span>')
_ARENA_RE = re.compile(r'<textarea id="arena_deck"[^>]*>(.*?)</textarea>', re.S)
_URL_RE = re.compile(r"(?:https?://(?:www\.)?mtgdecks\.net)?/([^/]+)/([^/?#]*-tournament-(\d+))", re.I)

BOARDS = {"deck": "main", "sideboard": "side", "commander": "commander", "companion": None}


def _get(url: str, fatal: bool = True) -> str | None:
    time.sleep(DELAY)
    return http_get(url, fatal=fatal)


def _table(html: str, marker: str) -> str:
    """The body of the first <table whose tag contains ``marker``."""
    i = html.find(marker)
    return html[i : html.find("</table>", i)] if i != -1 else ""


def _approx_date(daymon: str, today: date) -> date | None:
    """Most recent plausible date for a year-less "05-Jul" list cell."""
    try:
        parsed = datetime.strptime(daymon, "%d-%b")
    except ValueError:
        return None
    for year in (today.year, today.year - 1):
        try:
            candidate = parsed.replace(year=year).date()
        except ValueError:  # Feb 29
            continue
        if candidate <= today + timedelta(days=2):
            return candidate
    return None


def _deck_cards(path: str) -> list[DeckCard]:
    """Parse a deck page's arena_deck plain-text export into card entries.

    Sections are "Commander"/"Deck"/"Sideboard"/"Companion" headers; a
    Companion is also listed under Sideboard, so its section is skipped.
    """
    m = _ARENA_RE.search(_get(BASE + path, fatal=False) or "")
    if not m:
        return []
    board, cards = "main", []
    for line in unescape(m.group(1)).splitlines():
        line = line.strip()
        if line.lower() in BOARDS:
            board = BOARDS[line.lower()]
            continue
        entry = re.match(r"(\d+)\s+(.+)", line)
        if entry and board:
            cards.append(DeckCard(entry.group(2).strip(), int(entry.group(1)), board))
    return cards


def _decks(event_html: str) -> list[Deck]:
    decks = []
    rows = _ROW_RE.findall(_table(event_html, '<table class="clickable table table-striped">'))
    for i, row in enumerate(rows, 0):  # row 0 is the header
        link = _DECK_LINK_RE.search(row)
        if not link:
            continue
        cards = _deck_cards(link.group(1))
        if not cards:
            continue
        row = row.replace("&nbsp;", " ")
        rank = _RANK_RE.search(row)
        record = _RECORD_RE.search(row)
        arch = _ARCHETYPE_RE.search(row)
        # The site lowercases player names and re-capitalizes with CSS; mimic
        # that, but leave names that already carry their own casing alone.
        raw = unescape(p.group(1)) if (p := _PLAYER_RE.search(row)) else "Unknown"
        decks.append(
            Deck(
                player=raw.title() if raw == raw.lower() else raw,
                archetype=unescape(arch.group(1)).strip() or None if arch else None,
                # Playoff rows show "Top8" instead of an ordinal; standings are
                # rank-ordered, so the row position stands in as the placement.
                placement=int(rank.group(1)) if rank else i,
                wins=int(record.group(1)) if record else None,
                losses=int(record.group(2)) if record else None,
                draws=int(record.group(3)) if record and record.group(3) else None,
                cards=cards,
            )
        )
    return decks


def _event(html: str, href: str, ext_id: str, fmt: str | None) -> Tournament | None:
    """Build a Tournament from an event page; None when it posts no decklists."""
    decks = _decks(html)
    if not decks:
        return None
    return Tournament(
        source=name,
        external_id=ext_id,
        name=unescape(re.sub(r"\s+", " ", m.group(1))).strip() if (m := _H1_RE.search(html)) else ext_id,
        format=fmt,
        held_on=m.group(1) if (m := _HELD_RE.search(html)) else None,
        source_url=BASE + href,
        player_count=int(m.group(1)) if (m := _PLAYERS_RE.search(html)) else None,
        decks=decks,
    )


def fetch_url(url: str) -> Tournament:
    """One event addressed by its mtgdecks.net URL, decks and records included.

    The format comes from the URL's path segment (see FORMATS); an unrecognized
    one gives a tournament with format None rather than failing.
    """
    m = _URL_RE.search(url.strip())
    if not m:
        raise SystemExit(f"Not an mtgdecks.net tournament URL: {url}")
    href = f"/{m.group(1)}/{m.group(2)}"
    fmt = next((code for path, code in FORMATS.items() if path.lower() == m.group(1).lower()), None)
    event = _event(_get(BASE + href), href, m.group(3), fmt)
    if not event:
        raise SystemExit(f"No decklists found at {BASE}{href}")
    return event


def _list_rows(path: str, page: int, today: date) -> list[tuple[str, str, date | None, bool]]:
    """(href, external_id, approx_date, is_mtgo) per event row, newest first."""
    html = _get(LIST_URL.format(path=path, page=page))
    out = []
    for row in _ROW_RE.findall(_table(html, '<table class="clickable')):
        link = _EVENT_LINK_RE.search(row)
        if not link:
            continue
        cell = _LIST_DATE_RE.search(row)
        approx = _approx_date(cell.group(1), today) if cell else None
        out.append((link.group(1), link.group(2), approx, "icons/mtgo.png" in row))
    return out


def fetch(since: date | None, before: date | None = None, formats: set[str] | None = None):
    """Yield mtgdecks.net events held on/after ``since`` (default: the last week).

    ``formats`` (a set of ``formats.code`` values from ``--format``) narrows the
    crawl to the matching site paths, so a Premodern-only run doesn't scan all 13
    formats. MTGDECKS_FORMATS still overrides with explicit site paths.
    """
    today = date.today()
    start = since or today - timedelta(days=DEFAULT_DAYS)
    env = os.environ.get("MTGDECKS_FORMATS")
    if env:
        paths = [p.strip() for p in env.split(",")]
    elif formats:
        paths = [p for p, code in FORMATS.items() if code in formats]
    else:
        paths = list(FORMATS)
    unknown = [p for p in paths if p not in FORMATS]
    if unknown:
        raise SystemExit(f"MTGDECKS_FORMATS: unknown format path(s) {unknown}; known: {', '.join(FORMATS)}")

    for path in paths:
        log(f"  {path} (since {start.isoformat()})")
        seen: set[str] = set()
        for page in range(1, MAX_PAGES + 1):
            rows = _list_rows(path, page, today)
            stop = not rows
            for href, ext_id, approx, is_mtgo in rows:
                if approx and approx < start:
                    stop = True  # date-desc list: everything below is older
                    break
                if before and approx and approx >= before:
                    continue  # date-desc list: too new for the window, keep scanning down
                if is_mtgo or ext_id in seen:  # mtgo.com events come from the mtgo source
                    continue
                seen.add(ext_id)
                print(f"\r    {href.rsplit('/', 1)[-1]}", end="", file=sys.stderr, flush=True)
                html = _get(BASE + href)
                held = m.group(1) if (m := _HELD_RE.search(html)) else None
                if held and held < start.isoformat():
                    continue
                if before and held and held >= before.isoformat():
                    continue
                event = _event(html, href, ext_id, FORMATS[path])
                if not event:
                    continue
                print(f"\r    {href.rsplit('/', 1)[-1]} — {len(event.decks)} decks", file=sys.stderr)
                yield event
            if stop:
                break
        print(file=sys.stderr)  # terminate any in-place counter line
