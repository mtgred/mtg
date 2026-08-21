"""spellbinder.gg tournament results.

spellbinder.gg is an aggregator: it re-publishes events from mtgo.com, melee.gg
and topdeck.gg under one normalized schema (its own archetype labels, a single
event/deck shape, one date filter for every format). It's a Next.js app with no
public API, but every page ships its data as an RSC "flight" payload — clean
JSON embedded in the HTML — so scraping is really just extracting three objects:

  /events?formats=…&from=…&to=…&page=N  ->  "eventsWithImages": the event list
  /events/<slug>                        ->  "decks": standings (player, placement, record, archetype)
  /decks/<shortId>                      ->  "enrichedDeck": {main, sideboard, commander} card lists

Asking for the payload directly with an ``RSC: 1`` header skips the rendered
HTML and roughly halves the transfer; if a build ever stops honoring it we fall
back to unwrapping the ``self.__next_f.push`` chunks out of the HTML.

Vercel's bot mitigation fronts the site and it works the *opposite* way from
mtgdecks: the honest non-browser UA in base.HEADERS is challenged (429 with
``X-Vercel-Mitigated: challenge``), a normal Chrome UA passes — so don't
"simplify" UA back to the default. Bursts also trip the same 429, hence DELAY;
base._request retries them with backoff.

Two env vars pick which upstream sources to take, because an aggregator's events
otherwise duplicate what our own adapters already ingest:

  SPELLBINDER_SKIP_SOURCES  denylist, default ``mtgo`` (what mtgdecks.py skips
                            too); set it empty to take everything
  SPELLBINDER_SOURCES       allowlist; wins outright when set

The allowlist exists for **spicerack.gg**, which shut down in May 2026 — its
events survive here and nowhere else, so ``SPELLBINDER_SOURCES=spicerack`` with
``--before 2026-06-01`` is the way to backfill them:

    SPELLBINDER_SOURCES=spicerack python scripts/ingest_tournaments.py \\
        --source spellbinder --since 2025-01-01 --before 2026-06-01

Neither filter can be pushed into the list query (it takes formats and dates
only), so the event list is still paged through in full — but at one request per
100 events that's cheap next to the per-event and per-deck fetches it skips.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date, timedelta
from itertools import count

from .base import Deck, DeckCard, Tournament, archetype_label, http_get, log

name = "spellbinder"

BASE = "https://www.spellbinder.gg"
# Browser UA (see module docstring) + the RSC header that returns the bare flight payload.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/x-component,text/html",
    "Accept-Language": "en-US,en;q=0.9",
    "RSC": "1",
}

# site format slug -> formats.code (identical apart from duel-commander)
FORMATS = {f: f for f in ("standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern", "commander")}
FORMATS["duel-commander"] = "duel"

DEFAULT_DAYS = 7  # window when --since is omitted
PAGE_SIZE = 100  # the list endpoint honors this; 32 is the site default
DECK_PAGE_SIZE = 128  # an event page's deck list clamps pageSize here (and defaults to 32)
MAX_PAGES = 200  # safety cap; the whole archive is ~13k events, so this covers it with headroom
DELAY = 1.5  # seconds between requests: bursts trip Vercel's 429 challenge

BOARDS = {"main": "main", "sideboard": "side", "commander": "commander"}  # enrichedDeck key -> board (maybeboard dropped)
_PUSH_RE = re.compile(r"self\.__next_f\.push\((.*?)\)</script>", re.S)
_RECORD_RE = re.compile(r"^(\d+)-(\d+)(?:-(\d+))?$")
_DECODER = json.JSONDecoder()


def _flight(url: str, fatal: bool = True) -> str:
    """Fetch a page and return its RSC flight payload.

    With the RSC header the response *is* the payload; a server that ignores it
    answers with HTML, whose payload arrives split across ``self.__next_f.push``
    chunks that concatenate back into the same text.
    """
    time.sleep(DELAY)
    body = http_get(url, fatal=fatal, headers=HEADERS) or ""
    if "self.__next_f" not in body:
        return body
    chunks = (json.loads(p) for p in _PUSH_RE.findall(body))
    return "".join(c[1] for c in chunks if len(c) > 1 and isinstance(c[1], str))


def _payloads(text: str, key: str):
    """Every literal JSON value of ``"key":`` in a flight payload.

    The payload as a whole isn't JSON (it's newline-delimited chunks holding
    React element trees), but each value is, so raw_decode reads exactly one
    object out of the middle of it — brace- and quote-safe, unlike counting
    delimiters past a mana cost like "{W}". A key repeats once per component
    that received it, and all but one copy is a string back-reference
    ("$6e:props:…", "$undefined") pointing at the real value; those are skipped.
    """
    for m in re.finditer(rf'"{key}":', text):
        try:
            value, _ = _DECODER.raw_decode(text, m.end())
        except ValueError:
            continue
        if value is not None and not isinstance(value, str):
            yield value


def _payload(text: str, key: str):
    return next(_payloads(text, key), None)


def _record(value: str | None) -> tuple[int | None, int | None, int | None]:
    m = _RECORD_RE.match(value or "")
    if not m:
        return None, None, None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)) if m.group(3) else None


def _deck_cards(short_id: str) -> list[DeckCard]:
    """Card entries from a deck page; within a board, cards are grouped by type.

    ``enrichedDeck`` is emitted several times and any single copy may have some
    boards back-referenced away, so boards are collected across all of them —
    otherwise a deck can come back with an empty maindeck.
    """
    merged: dict[str, dict] = {}
    for deck in _payloads(_flight(f"{BASE}/decks/{short_id}", fatal=False), "enrichedDeck"):
        for key in BOARDS:
            if key not in merged and isinstance(deck.get(key), dict):
                merged[key] = deck[key]
    return [
        DeckCard(c["name"], c["quantity"], BOARDS[key])
        for key, groups in merged.items()
        for group in groups.values()
        if isinstance(group, list)
        for c in group
        if c.get("name") and c.get("quantity")
    ]


def _standings(slug: str):
    """Every standings row for an event, paging the event page's deck list.

    The list is paginated and defaults to 32 rows, so a single fetch silently
    truncates any event bigger than that. ``pageSize`` is honored up to
    DECK_PAGE_SIZE and clamped above it, hence paging rather than one big ask.
    Pages are also deduped by shortId, so a build that ignored ``page`` would
    terminate instead of looping forever.
    """
    seen: set[str] = set()
    for page in count(1):
        url = f"{BASE}/events/{slug}?pageSize={DECK_PAGE_SIZE}&page={page}"
        rows = _payload(_flight(url, fatal=False), "decks") or []
        fresh = [d for d in rows if d.get("shortId") and d["shortId"] not in seen]
        seen.update(d["shortId"] for d in fresh)
        yield from fresh
        if len(rows) < DECK_PAGE_SIZE or not fresh:
            return


def _decks(slug: str) -> list[Deck]:
    """Every published deck for an event — one request each, no cap.

    Large events run to a few hundred decks (and a few hundred DELAYs), which is
    slow but wanted: some of what's here, spicerack's especially, exists nowhere
    else to re-fetch later.
    """
    out: list[Deck] = []
    for d in _standings(slug):
        cards = _deck_cards(d["shortId"])
        if not cards:
            continue
        wins, losses, draws = _record(d.get("record"))
        out.append(
            Deck(
                player=d.get("player") or "Unknown",
                # Their classifier falls back to a bare color identity ("W",
                # "WUBRG") when it can't place a deck, while `deck_title` keeps
                # the human name ("White Weenie") — so take whichever actually
                # names a deck, classifier first (it normalizes "Burn" to
                # "Sligh"), and store nothing when neither does.
                archetype=archetype_label(d.get("archetype"), d.get("deck_title")),
                placement=d.get("placement"),
                wins=wins,
                losses=losses,
                draws=draws,
                cards=cards,
            )
        )
    return out


def _events(codes: list[str], start: date, end: date | None, page: int) -> tuple[list[dict], int]:
    """One page of the event list (newest first, filtered server-side) and the
    total number of events matching the query."""
    query = f"formats={','.join(codes)}&from={start.isoformat()}&pageSize={PAGE_SIZE}&page={page}"
    if end:
        query += f"&to={end.isoformat()}"  # inclusive upper bound
    payload = _flight(f"{BASE}/events?{query}")
    total = _payload(payload, "totalCount")
    return _payload(payload, "eventsWithImages") or [], total if isinstance(total, int) else 0


def _wanted(source: str | None) -> bool:
    """Whether an event's upstream source should be ingested.

    SPELLBINDER_SOURCES is an allowlist and wins outright — ``spicerack`` for a
    defunct-source backfill, say. Otherwise SPELLBINDER_SKIP_SOURCES applies (see
    the module docstring); set it empty to take everything.
    """
    if only := {s.strip() for s in os.environ.get("SPELLBINDER_SOURCES", "").split(",") if s.strip()}:
        return source in only
    return source not in {s.strip() for s in os.environ.get("SPELLBINDER_SKIP_SOURCES", "mtgo").split(",") if s.strip()}


def fetch(since: date | None, before: date | None = None, formats: set[str] | None = None):
    """Yield spellbinder.gg events held on/after ``since`` (default: the last week).

    Both bounds are pushed into the list query, so a narrow window costs one
    request per 100 events rather than a crawl back through the archive.
    ``formats`` narrows the same query; unmapped codes simply match nothing.

    Filtering by upstream source (see ``_wanted``) can't be pushed into the query
    — the list is still paged through in full — but it's applied before the
    per-event and per-deck fetches, which is where the time actually goes.
    """
    start = since or date.today() - timedelta(days=DEFAULT_DAYS)
    end = before - timedelta(days=1) if before else None  # --before is exclusive, `to` is not
    codes = [s for s, code in FORMATS.items() if not formats or code in formats]
    if not codes:
        return

    log(f"  {len(codes)} format(s) since {start.isoformat()}" + (f" before {before.isoformat()}" if before else ""))
    for page in range(1, MAX_PAGES + 1):
        events, total = _events(codes, start, end, page)
        pages = -(-total // PAGE_SIZE)  # ceil
        if page == 1 and pages > MAX_PAGES:
            log(f"  ! {total} events span {pages} pages; MAX_PAGES={MAX_PAGES} truncates — narrow the window")
        log(f"  page {page}/{max(pages, 1)} ({total} events match)")
        for e in events:
            if not _wanted(e.get("source")):
                continue
            print(f"\r    {e['slug']}", end="", file=sys.stderr, flush=True)
            decks = _decks(e["slug"])
            if not decks:
                continue
            print(f"\r    {e['slug']} — {len(decks)} decks", file=sys.stderr)
            yield Tournament(
                source=name,
                external_id=e["slug"],
                name=e.get("name") or e["slug"],
                format=FORMATS.get(e.get("format")),
                held_on=e.get("date"),
                source_url=f"{BASE}/events/{e['slug']}",
                player_count=e.get("player_count"),
                decks=decks,
            )
        if len(events) < PAGE_SIZE:
            break
    print(file=sys.stderr)  # terminate any in-place counter line
