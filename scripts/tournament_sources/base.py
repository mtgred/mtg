"""Shared types and helpers for tournament ingest sources.

A *source* turns one external site (MTGO, melee.gg, ...) into a stream of
normalized ``Tournament`` objects. Everything downstream — card-name
resolution, idempotent upsert SQL, applying to a database — is written once in
scripts/ingest_tournaments.py and is identical for every source. Adding a source
means writing one small module that yields ``Tournament``s; see mtgo.py.

Stdlib only, matching scripts/generate_seed.py.
"""

from __future__ import annotations

import http.client
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Protocol

HEADERS = {
    "User-Agent": "manaring-tournament-ingest/1.0 (https://github.com/mtgred/mtg)",
    "Accept": "text/html,application/json",
}
REQUEST_DELAY = 0.1  # polite delay between requests
MAX_ATTEMPTS = 4  # total tries per request before giving up
RETRY_BACKOFF = 2.0  # base seconds for exponential backoff between retries
RETRY_STATUS = {429, 500, 502, 503, 504}  # transient HTTP statuses worth retrying

# Transient network failures that should be retried rather than aborting a long
# run: dropped/reset connections (RemoteDisconnected, ConnectionError), read
# timeouts (TimeoutError), and malformed/short responses (other HTTPException
# such as BadStatusLine / IncompleteRead).
TRANSIENT_ERRORS = (http.client.HTTPException, ConnectionError, TimeoutError)


@dataclass
class DeckCard:
    name: str  # must match cards.name (Scryfall oracle name); unresolved names are skipped on insert
    quantity: int
    board: str = "main"  # 'main' | 'side' | 'commander'


@dataclass
class Deck:
    player: str
    archetype: str | None = None
    placement: int | None = None
    wins: int | None = None
    losses: int | None = None
    draws: int | None = None
    cards: list[DeckCard] = field(default_factory=list)


@dataclass
class Tournament:
    source: str  # adapter name, e.g. 'mtgo'
    external_id: str  # stable id at the source; (source, external_id) is the upsert key
    name: str
    format: str | None = None  # a formats.code value, or None
    held_on: str | None = None  # ISO date (YYYY-MM-DD)
    location: str | None = None
    source_url: str | None = None
    player_count: int | None = None
    decks: list[Deck] = field(default_factory=list)


class Source(Protocol):
    name: str

    def fetch(self, since: date | None) -> Iterable[Tournament]:
        """Yield tournaments held on/after ``since`` (None = source's default window)."""
        ...


def http_get(url: str, fatal: bool = True, headers: dict | None = None) -> str | None:
    """GET a URL and return the decoded body, with a descriptive User-Agent.

    ``fatal=False`` returns None on an HTTP/network error instead of aborting —
    for per-item fetches (a single deck page) that shouldn't kill a long run.
    ``headers`` overrides/extends the defaults (some sources reject our UA).
    """
    return _request(urllib.request.Request(url, headers={**HEADERS, **(headers or {})}), fatal)


def http_post(url: str, data: dict, fatal: bool = True, headers: dict | None = None) -> str | None:
    """POST form-encoded ``data`` (e.g. an AJAX/DataTables endpoint) and return the body."""
    merged = {
        **HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        **(headers or {}),
    }
    body = urllib.parse.urlencode(data).encode()
    return _request(urllib.request.Request(url, data=body, headers=merged), fatal)


def _request(req: urllib.request.Request, fatal: bool) -> str | None:
    """Perform the request, retrying transient failures with exponential backoff.

    Network blips (RemoteDisconnected, resets, read timeouts, short reads) and
    transient HTTP statuses (429/5xx) are retried up to ``MAX_ATTEMPTS`` rather
    than killing a multi-hour ingest. A permanent failure (non-retryable 4xx, or
    retries exhausted) aborts when ``fatal``; otherwise it returns None.
    """
    last: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in RETRY_STATUS:
                if not fatal:
                    return None
                raise SystemExit(f"HTTP {exc.code} fetching {req.full_url}: {exc.reason}")
        except (urllib.error.URLError, *TRANSIENT_ERRORS) as exc:
            # URLError often wraps the transient OSError we care about (its
            # .reason); treat the whole class as retryable.
            last = exc
        finally:
            time.sleep(REQUEST_DELAY)
        if attempt < MAX_ATTEMPTS:
            wait = RETRY_BACKOFF * 2 ** (attempt - 1)
            log(f"  retry {attempt}/{MAX_ATTEMPTS - 1} for {req.full_url} in {wait:.0f}s ({last})")
            time.sleep(wait)
    if not fatal:
        return None
    raise SystemExit(f"Failed to reach {req.full_url} after {MAX_ATTEMPTS} attempts: {last}")


def log(msg: str) -> None:
    print(msg, file=sys.stderr)
