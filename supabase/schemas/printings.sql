-- Print-specific data: one row per physical printing of a card.
CREATE TABLE printings (
  id UUID PRIMARY KEY,                        -- Scryfall card id (the print's id)
  card_id INT REFERENCES cards(id) NOT NULL,
  set_id INT REFERENCES sets(id) NOT NULL,
  rarity VARCHAR(15) NOT NULL,
  artist VARCHAR(255),
  collector_number VARCHAR(15),               -- string: can contain letters/symbols ("140a", "★123")
  lang VARCHAR(7) NOT NULL DEFAULT 'en',
  released_at DATE,
  border_color VARCHAR(15),
  frame VARCHAR(15),                          -- frame style, e.g. "1997", "2015"
  flavor_text TEXT,
  full_art BOOLEAN,
  textless BOOLEAN,
  promo BOOLEAN,
  reprint BOOLEAN,
  variation BOOLEAN,
  digital BOOLEAN,                            -- digital-only printing (MTGO/Arena)
  finishes TEXT[],                            -- e.g. {nonfoil,foil,etched}
  multiverse_ids INT[],                       -- Gatherer
  arena_id INT,                               -- MTG Arena id
  mtgo_id INT,                                -- MTGO (nonfoil) id
  mtgo_foil_id INT,                           -- MTGO foil id
  tcgplayer_id INT,
  cardmarket_id INT,
  illustration_id UUID,
  image_uris JSONB,                           -- size -> URL map
  prices JSONB                                -- usd/usd_foil/eur/tix/...
);
