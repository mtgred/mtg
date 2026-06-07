#!/usr/bin/env python3
"""Generate supabase/seed.sql from Scryfall data.

Fetches every Magic set from the Scryfall ``/sets`` endpoint and every card
printing from the Scryfall bulk-data export, then writes INSERT statements for
the ``sets``, ``cards`` and ``printings`` tables defined in the schema.

The script depends only on the Python standard library.

Usage:
    python supabase/generate_seed.py
    python supabase/generate_seed.py --limit 500 --output supabase/seed.sql
    python supabase/generate_seed.py --include-digital --exclude-tokens

Scryfall asks API consumers to send a descriptive User-Agent and to throttle
requests; both are handled here. See https://scryfall.com/docs/api for the
terms of use (data is licensed CC0 / under Wizards' fan content policy).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SCRYFALL_API = "https://api.scryfall.com"
# Scryfall requests a unique, descriptive User-Agent for every client.
HEADERS = {
    "User-Agent": "mtg-seed-generator/1.0 (https://github.com/mtgred/mtg)",
    "Accept": "application/json",
}
# Polite delay between API calls (Scryfall recommends 50-100ms).
REQUEST_DELAY = 0.1
# Rows per multi-row INSERT statement. Keeps individual statements parseable
# while avoiding one statement per row in a file with ~100k printings.
BATCH_SIZE = 1000


def fetch_json(url: str):
    """GET a URL and parse the JSON body, with a descriptive User-Agent."""
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        sys.exit(f"HTTP {exc.code} fetching {url}: {exc.reason}")
    except urllib.error.URLError as exc:
        sys.exit(f"Failed to reach {url}: {exc.reason}")


def fetch_sets() -> dict[str, dict]:
    """Return a mapping of set code -> full Scryfall set object."""
    print("Fetching sets...", file=sys.stderr)
    sets: dict[str, dict] = {}
    url = f"{SCRYFALL_API}/sets"
    while url:
        data = fetch_json(url)
        for s in data["data"]:
            sets[s["code"]] = s
        url = data.get("next_page") if data.get("has_more") else None
        if url:
            time.sleep(REQUEST_DELAY)
    print(f"  {len(sets)} sets", file=sys.stderr)
    return sets


def fetch_bulk_cards(bulk_type: str):
    """Download and parse a Scryfall bulk-data export (one object per card)."""
    print(f"Locating '{bulk_type}' bulk export...", file=sys.stderr)
    catalog = fetch_json(f"{SCRYFALL_API}/bulk-data")
    item = next((d for d in catalog["data"] if d["type"] == bulk_type), None)
    if item is None:
        available = ", ".join(d["type"] for d in catalog["data"])
        sys.exit(f"Unknown bulk type '{bulk_type}'. Available: {available}")

    size_mb = item.get("size", 0) / (1024 * 1024)
    print(
        f"Downloading {item['download_uri']} (~{size_mb:.0f} MB)...",
        file=sys.stderr,
    )
    req = urllib.request.Request(item["download_uri"], headers=HEADERS)
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


def is_real_card(card: dict, include_digital: bool, include_tokens: bool) -> bool:
    """Filter out printings we don't want to seed.

    By default skips digital-only cards (Alchemy/MTGO/Arena rebalances) but
    keeps token/emblem layouts, so token sets are seeded with their cards.
    """
    if not include_digital and card.get("digital"):
        return False
    if not include_tokens:
        layout = card.get("layout", "")
        if layout in {"token", "double_faced_token", "emblem", "art_series"}:
            return False
    return True


def _face_join(card: dict, key: str, sep: str):
    """Top-level value for ``key``, or the faces joined when it lives per-face.

    Double-faced / split / adventure layouts carry ``mana_cost``, ``type_line``,
    ``oracle_text`` etc. inside ``card_faces`` rather than at the top level.
    """
    value = card.get(key)
    if value is not None:
        return value
    parts = [f.get(key) for f in card.get("card_faces") or [] if f.get(key)]
    return sep.join(parts) if parts else None


def oracle_fields(card: dict) -> dict:
    """Extract oracle-level (gameplay) columns shared by every printing."""
    colors = card.get("colors")
    if colors is None:  # combine faces for split/transform layouts
        merged: list[str] = []
        for face in card.get("card_faces") or []:
            for color in face.get("colors") or []:
                if color not in merged:
                    merged.append(color)
        colors = merged or None

    return {
        "oracle_id": card.get("oracle_id"),
        "name": card.get("name"),
        "mana_cost": _face_join(card, "mana_cost", " // "),
        "cmc": card.get("cmc"),
        "type_line": _face_join(card, "type_line", " // "),
        "oracle_text": _face_join(card, "oracle_text", "\n//\n"),
        "colors": colors,
        "color_identity": card.get("color_identity"),
        "keywords": card.get("keywords"),
        "power": _face_join(card, "power", " // "),
        "toughness": _face_join(card, "toughness", " // "),
        "loyalty": _face_join(card, "loyalty", " // "),
        "reserved": card.get("reserved"),
        "legalities": card.get("legalities"),
        "edhrec_rank": card.get("edhrec_rank"),
    }


def printing_fields(card: dict) -> dict:
    """Extract print-specific columns for a single Scryfall card object."""
    image_uris = card.get("image_uris")
    if image_uris is None:  # double-faced cards carry images per face
        faces = card.get("card_faces") or []
        if faces and faces[0].get("image_uris"):
            image_uris = faces[0]["image_uris"]

    flavor_text = card.get("flavor_text")
    if flavor_text is None:
        parts = [f.get("flavor_text") for f in card.get("card_faces") or [] if f.get("flavor_text")]
        flavor_text = "\n//\n".join(parts) if parts else None

    return {
        "id": card.get("id"),
        "rarity": card.get("rarity"),
        "artist": card.get("artist"),
        "collector_number": card.get("collector_number"),
        "lang": card.get("lang") or "en",
        "released_at": card.get("released_at"),
        "border_color": card.get("border_color"),
        "frame": card.get("frame"),
        "flavor_text": flavor_text,
        "full_art": card.get("full_art"),
        "textless": card.get("textless"),
        "promo": card.get("promo"),
        "reprint": card.get("reprint"),
        "variation": card.get("variation"),
        "digital": card.get("digital"),
        "finishes": card.get("finishes"),
        "multiverse_ids": card.get("multiverse_ids"),
        "arena_id": card.get("arena_id"),
        "mtgo_id": card.get("mtgo_id"),
        "mtgo_foil_id": card.get("mtgo_foil_id"),
        "tcgplayer_id": card.get("tcgplayer_id"),
        "cardmarket_id": card.get("cardmarket_id"),
        "illustration_id": card.get("illustration_id"),
        "image_uris": image_uris,
        "prices": card.get("prices"),
    }


def set_fields(s: dict, set_id: int) -> dict:
    """Extract set-level columns from a Scryfall set object."""
    return {
        "id": set_id,
        "scryfall_id": s.get("id"),
        "code": s.get("code"),
        "mtgo_code": s.get("mtgo_code"),
        "arena_code": s.get("arena_code"),
        "tcgplayer_id": s.get("tcgplayer_id"),
        "name": s.get("name"),
        "set_type": s.get("set_type"),
        "released_at": s.get("released_at"),
        "block_code": s.get("block_code"),
        "block": s.get("block"),
        "parent_set_code": s.get("parent_set_code"),
        "card_count": s.get("card_count"),
        "printed_size": s.get("printed_size"),
        "digital": s.get("digital"),
        "foil_only": s.get("foil_only"),
        "nonfoil_only": s.get("nonfoil_only"),
        "icon_svg_uri": s.get("icon_svg_uri"),
        "scryfall_uri": s.get("scryfall_uri"),
    }


def build_dataset(cards_raw, sets_by_code, include_digital, include_tokens):
    """Turn raw Scryfall card objects into ordered rows for each table.

    Returns ``(sets_rows, cards_rows, printing_rows)`` as lists of dicts keyed
    by column name. Cards are deduplicated by name (oracle level); every kept
    Scryfall object becomes one printing row keyed by its own UUID. Only sets
    that actually have a printing are emitted, so there are no orphan set rows.
    """
    card_ids: dict[str, int] = {}
    set_ids: dict[str, int] = {}
    cards_rows: list[dict] = []
    printing_rows: list[dict] = []
    skipped = 0

    for card in cards_raw:
        if not is_real_card(card, include_digital, include_tokens):
            continue
        name = card.get("name")
        code = card.get("set")
        # cards.oracle_id is NOT NULL; a few odd layouts (e.g. reversible_card)
        # have no single top-level oracle_id, so skip them rather than emit a
        # row that would violate the constraint.
        if not name or not code or not card.get("oracle_id"):
            skipped += 1
            continue

        card_id = card_ids.get(name)
        if card_id is None:
            card_id = len(card_ids) + 1
            card_ids[name] = card_id
            row = oracle_fields(card)
            row["id"] = card_id
            cards_rows.append(row)

        set_id = set_ids.get(code)
        if set_id is None:
            set_id = len(set_ids) + 1
            set_ids[code] = set_id

        printing = printing_fields(card)
        printing["card_id"] = card_id
        printing["set_id"] = set_id
        printing_rows.append(printing)

    sets_rows = [
        set_fields(sets_by_code.get(code, {"code": code, "name": code}), set_id)
        for code, set_id in set_ids.items()
    ]

    if skipped:
        print(
            f"  skipped {skipped} objects with no name/set/oracle_id",
            file=sys.stderr,
        )

    return sets_rows, cards_rows, printing_rows


def lit_str(value) -> str:
    """Quote a string as a SQL literal (or NULL), escaping single quotes."""
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def lit_num(value) -> str:
    """A numeric literal, or NULL."""
    return "null" if value is None else str(value)


def lit_bool(value) -> str:
    """A boolean literal, or NULL."""
    if value is None:
        return "null"
    return "true" if value else "false"


def lit_text_array(value) -> str:
    """A ``text[]`` array literal, or NULL for empty/missing values."""
    if not value:
        return "null"
    return "array[" + ", ".join(lit_str(v) for v in value) + "]::text[]"


def lit_int_array(value) -> str:
    """An ``int[]`` array literal, or NULL for empty/missing values."""
    if not value:
        return "null"
    return "array[" + ", ".join(str(v) for v in value) + "]::int[]"


def lit_jsonb(value) -> str:
    """A ``jsonb`` literal, or NULL."""
    if value is None:
        return "null"
    return lit_str(json.dumps(value, separators=(",", ":"))) + "::jsonb"


# (column name, value formatter) pairs, in INSERT order, per table.
SET_COLUMNS = [
    ("id", lit_num),
    ("scryfall_id", lit_str),
    ("code", lit_str),
    ("mtgo_code", lit_str),
    ("arena_code", lit_str),
    ("tcgplayer_id", lit_num),
    ("name", lit_str),
    ("set_type", lit_str),
    ("released_at", lit_str),
    ("block_code", lit_str),
    ("block", lit_str),
    ("parent_set_code", lit_str),
    ("card_count", lit_num),
    ("printed_size", lit_num),
    ("digital", lit_bool),
    ("foil_only", lit_bool),
    ("nonfoil_only", lit_bool),
    ("icon_svg_uri", lit_str),
    ("scryfall_uri", lit_str),
]

CARD_COLUMNS = [
    ("id", lit_num),
    ("oracle_id", lit_str),
    ("name", lit_str),
    ("mana_cost", lit_str),
    ("cmc", lit_num),
    ("type_line", lit_str),
    ("oracle_text", lit_str),
    ("colors", lit_text_array),
    ("color_identity", lit_text_array),
    ("keywords", lit_text_array),
    ("power", lit_str),
    ("toughness", lit_str),
    ("loyalty", lit_str),
    ("reserved", lit_bool),
    ("legalities", lit_jsonb),
    ("edhrec_rank", lit_num),
]

PRINTING_COLUMNS = [
    ("id", lit_str),
    ("card_id", lit_num),
    ("set_id", lit_num),
    ("rarity", lit_str),
    ("artist", lit_str),
    ("collector_number", lit_str),
    ("lang", lit_str),
    ("released_at", lit_str),
    ("border_color", lit_str),
    ("frame", lit_str),
    ("flavor_text", lit_str),
    ("full_art", lit_bool),
    ("textless", lit_bool),
    ("promo", lit_bool),
    ("reprint", lit_bool),
    ("variation", lit_bool),
    ("digital", lit_bool),
    ("finishes", lit_text_array),
    ("multiverse_ids", lit_int_array),
    ("arena_id", lit_num),
    ("mtgo_id", lit_num),
    ("mtgo_foil_id", lit_num),
    ("tcgplayer_id", lit_num),
    ("cardmarket_id", lit_num),
    ("illustration_id", lit_str),
    ("image_uris", lit_jsonb),
    ("prices", lit_jsonb),
]


def write_insert(out, table: str, spec, rows):
    """Write batched multi-row INSERT statements for a table.

    ``spec`` is a list of ``(column_name, formatter)`` pairs; each row is a
    dict keyed by column name.
    """
    if not rows:
        return
    col_list = ", ".join(name for name, _ in spec)
    for start in range(0, len(rows), BATCH_SIZE):
        chunk = rows[start : start + BATCH_SIZE]
        out.write(f"insert into {table} ({col_list}) values\n")
        values = ",\n".join(
            "  (" + ", ".join(fmt(row.get(name)) for name, fmt in spec) + ")"
            for row in chunk
        )
        out.write(values + ";\n\n")


def write_seed(path: Path, sets_rows, cards_rows, printing_rows):
    """Write the complete seed.sql file."""
    with path.open("w", encoding="utf-8") as out:
        out.write("-- Generated by supabase/generate_seed.py\n")
        out.write("-- Source: Scryfall API (https://scryfall.com/docs/api)\n")
        out.write(
            f"-- {len(sets_rows)} sets, {len(cards_rows)} cards, "
            f"{len(printing_rows)} printings\n\n"
        )
        out.write("begin;\n\n")
        out.write(
            "truncate table printings, cards, sets restart identity cascade;\n\n"
        )

        write_insert(out, "sets", SET_COLUMNS, sets_rows)
        write_insert(out, "cards", CARD_COLUMNS, cards_rows)
        write_insert(out, "printings", PRINTING_COLUMNS, printing_rows)

        # Keep the SERIAL sequences in sync with the explicit ids we inserted.
        # (printings uses a UUID primary key, so it has no sequence.)
        out.write(
            "select setval('sets_id_seq', "
            "(select coalesce(max(id), 1) from sets));\n"
        )
        out.write(
            "select setval('cards_id_seq', "
            "(select coalesce(max(id), 1) from cards));\n\n"
        )
        out.write("commit;\n")


def parse_args(argv=None):
    default_output = Path(__file__).resolve().parent / "../supabase/seed.sql"
    parser = argparse.ArgumentParser(
        description="Generate supabase/seed.sql from Scryfall data."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help="Path to write the seed file (default: supabase/seed.sql).",
    )
    parser.add_argument(
        "--bulk-type",
        default="default_cards",
        help="Scryfall bulk-data type to use (default: default_cards, one "
        "printing per card in its best English form).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N raw card objects (useful for testing "
        "or generating a small seed).",
    )
    parser.add_argument(
        "--include-digital",
        action="store_true",
        help="Include digital-only printings (Alchemy/MTGO/Arena).",
    )
    parser.add_argument(
        "--exclude-tokens",
        dest="include_tokens",
        action="store_false",
        help="Exclude token, emblem and art-series printings (included by "
        "default).",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    sets_by_code = fetch_sets()
    cards_raw = fetch_bulk_cards(args.bulk_type)
    if args.limit is not None:
        cards_raw = cards_raw[: args.limit]
    print(f"Processing {len(cards_raw)} card objects...", file=sys.stderr)

    sets_rows, cards_rows, printing_rows = build_dataset(
        cards_raw, sets_by_code, args.include_digital, args.include_tokens
    )

    write_seed(args.output, sets_rows, cards_rows, printing_rows)
    print(
        f"Wrote {args.output}: {len(sets_rows)} sets, {len(cards_rows)} cards, "
        f"{len(printing_rows)} printings.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
