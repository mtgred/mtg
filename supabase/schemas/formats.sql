-- Constructed formats a deck can be built for. `code` matches the keys used in
-- cards.legalities (Scryfall legality names), so a deck's format lines up with
-- the corresponding per-card legality. Curated reference data (see
-- supabase/seeds/formats.sql); public read-only, like sets/cards.
CREATE TABLE formats (
  code VARCHAR(31) PRIMARY KEY,        -- e.g. "modern", matches cards.legalities keys
  name VARCHAR(63) NOT NULL UNIQUE,    -- display name, e.g. "Modern"
  sort_order INT,                      -- ordering for format pickers
  description TEXT,                    -- curated prose describing the format
  -- Curated banned/restricted card-name overrides, by exact cards.name. Scryfall's
  -- per-card `legalities` is authoritative for official formats, but for community
  -- formats (e.g. Old School) its data is incomplete; when these arrays are set the
  -- format page uses them as the source of truth instead of the legalities column.
  banned_cards TEXT[],
  restricted_cards TEXT[]
);
