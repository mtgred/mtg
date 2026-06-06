CREATE TABLE sets (
  id SERIAL PRIMARY KEY,
  code VARCHAR(15) NOT NULL UNIQUE,    -- e.g. "jud"
  name VARCHAR(255) NOT NULL UNIQUE,   -- e.g. "Judgment"
  scryfall_id UUID UNIQUE,             -- Scryfall set id
  mtgo_code VARCHAR(15),               -- set code on MTGO, if any
  arena_code VARCHAR(15),              -- set code on MTG Arena, if any
  tcgplayer_id INT,                    -- TCGplayer groupId
  set_type VARCHAR(31),                -- e.g. "expansion", "core", "promo"
  released_at DATE,                    -- release date (or first known printing)
  block_code VARCHAR(15),              -- block code, e.g. "ody"
  block VARCHAR(255),                  -- block name, e.g. "Odyssey"
  parent_set_code VARCHAR(15),         -- parent set code for tokens/promos/etc.
  card_count INT,                      -- number of cards in the set
  printed_size INT,                    -- denominator on collector numbers, if known
  digital BOOLEAN,                     -- digital-only set
  foil_only BOOLEAN,                   -- only available in foil
  nonfoil_only BOOLEAN,                -- only available in nonfoil
  icon_svg_uri TEXT,                   -- URI to the set's SVG icon
  scryfall_uri TEXT                    -- permalink on scryfall.com
);
