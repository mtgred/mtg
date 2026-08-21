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
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Protocol

HEADERS = {
    "User-Agent": "tournament-ingest/1.0",
    "Accept": "text/html,application/json",
}
REQUEST_DELAY = 0.1  # polite delay between requests
MAX_ATTEMPTS = 4  # total tries per request before giving up
RETRY_BACKOFF = 2.0  # base seconds for exponential backoff between retries
RETRY_STATUS = {429, 500, 502, 503, 504}  # transient HTTP statuses worth retrying
RETRY_AFTER_CAP = 1800  # honor a server's Retry-After up to this long (mtgdecks meters deck pages in ~12-min windows)
CHALLENGE_WAIT = 30  # backoff for a Cloudflare interstitial, which carries no Retry-After (see `challenges`)

# Transient network failures that should be retried rather than aborting a long
# run: dropped/reset connections (RemoteDisconnected, ConnectionError), read
# timeouts (TimeoutError), and malformed/short responses (other HTTPException
# such as BadStatusLine / IncompleteRead).
TRANSIENT_ERRORS = (http.client.HTTPException, ConnectionError, TimeoutError)

# Cloudflare answers a too-fast crawler with an interstitial challenge ("Just a
# moment...") sent as 429 *without* a Retry-After — it is a rate signal, not a
# quota, and it clears on its own once the caller eases off. Sources read this
# running count to widen their own pacing mid-run; see mtgdecks._get.
challenges = 0


# Labels that name no deck: a color identity ("W", "UB", "WUBRG") or a source's
# placeholder for "we couldn't classify this". Aggregators fall back to these
# when their own classifier comes up empty, and storing one is worse than storing
# nothing — it reads as an archetype in the UI, matches no rule in
# supabase/schemas/archetypes.sql, and inflates the archetype list with a row per
# color combination. See `archetype_label`.
_COLOR_CODE_RE = re.compile(r"^[WUBRGC]{1,5}$")
_NON_LABELS = {"unknown", "other", "n/a", "na", "none", "-", "deck", "untitled"}


def archetype_label(*candidates: str | None) -> str | None:
    """First candidate that actually names a deck, else None.

    Sources often carry more than one label per deck (a classifier field and a
    free-text title, say); pass them in order of preference and this picks the
    first meaningful one, so a junk value falls through to the next instead of
    being stored.
    """
    for c in candidates:
        c = (c or "").strip()
        if c and c.lower() not in _NON_LABELS and not _COLOR_CODE_RE.match(c.upper()):
            return c
    return None


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

    def fetch(self, since: date | None, before: date | None = None, formats: set[str] | None = None) -> Iterable[Tournament]:
        """Yield tournaments held on/after ``since`` and strictly before ``before``.

        ``since`` None means the source's default window; ``before`` None means no
        upper bound. Together they form the half-open window ``[since, before)``.
        Sources apply ``before`` during the crawl (not just as a post-filter) so a
        bounded window doesn't fetch events newer than ``before``.

        ``formats`` is the set of requested ``formats.code`` values (lowercased,
        from ``--format``), or None for all. Sources that can cheaply narrow their
        crawl by format (e.g. mtgdecks scans one page tree per format) should
        honor it; those that discover the format only per event may ignore it —
        the caller filters the yielded stream by ``formats`` regardless.
        """
        ...


def _ascii(url: str) -> str:
    """Percent-encode non-ASCII in a URL — hrefs scraped from HTML can carry raw
    Unicode (e.g. Cyrillic in an event slug), which http.client rejects."""
    return urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%")


def http_get(url: str, fatal: bool = True, headers: dict | None = None) -> str | None:
    """GET a URL and return the decoded body, with a descriptive User-Agent.

    ``fatal=False`` returns None on an HTTP/network error instead of aborting —
    for per-item fetches (a single deck page) that shouldn't kill a long run.
    ``headers`` overrides/extends the defaults (some sources reject our UA).
    """
    return _request(urllib.request.Request(_ascii(url), headers={**HEADERS, **(headers or {})}), fatal)


def http_post(url: str, data: dict, fatal: bool = True, headers: dict | None = None, as_json: bool = False) -> str | None:
    """POST ``data`` form-encoded (e.g. an AJAX/DataTables endpoint) or, with
    ``as_json``, as a JSON body (e.g. the topdeck.gg API); returns the body."""
    merged = {
        **HEADERS,
        "Content-Type": "application/json" if as_json else "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        **(headers or {}),
    }
    body = (json.dumps(data) if as_json else urllib.parse.urlencode(data)).encode()
    return _request(urllib.request.Request(_ascii(url), data=body, headers=merged), fatal)


def _challenged(exc: Exception | None) -> bool:
    """Is this failure a Cloudflare interstitial rather than a real response?"""
    return (getattr(exc, "headers", None) or {}).get("Cf-Mitigated") == "challenge"


def _request(req: urllib.request.Request, fatal: bool) -> str | None:
    """Perform the request, retrying transient failures with exponential backoff.

    Network blips (RemoteDisconnected, resets, read timeouts, short reads) and
    transient HTTP statuses (429/5xx) are retried up to ``MAX_ATTEMPTS`` rather
    than killing a multi-hour ingest. A permanent failure (non-retryable 4xx, or
    retries exhausted) aborts when ``fatal``; otherwise it returns None.
    """
    global challenges
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
            retry_after = (getattr(last, "headers", None) or {}).get("Retry-After", "")
            if retry_after.isdigit():  # rate-limited: the server says exactly how long to back off
                wait = min(int(retry_after) + 1, RETRY_AFTER_CAP)
            elif _challenged(last):  # no Retry-After to go on; a few seconds is never enough
                challenges += 1
                wait = max(wait, CHALLENGE_WAIT)
            log(f"  retry {attempt}/{MAX_ATTEMPTS - 1} for {req.full_url} in {wait:.0f}s ({last})")
            time.sleep(wait)
    if not fatal:
        return None
    raise SystemExit(f"Failed to reach {req.full_url} after {MAX_ATTEMPTS} attempts: {last}")


def log(msg: str) -> None:
    print(msg, file=sys.stderr)
