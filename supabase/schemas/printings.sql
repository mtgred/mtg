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

-- One representative printing per oracle card: the earliest-released printing
-- (then lowest collector number), excluding token sets so a card like Sacred Cat
-- (which also has an embalm-token printing under the same oracle id) links to the
-- actual card and never to a token. Lets oracle-level references (e.g. decklists)
-- fetch art + a linkable printing id with a single row per card, instead of
-- pulling every printing and hitting the API row cap. Token sets, promo prints,
-- and foil-only prints are excluded so the representative print is a normal
-- nonfoil release; Limited Edition Alpha is deprioritized so its cards resolve to
-- the (visually identical) Beta printing, which every Alpha card was reprinted
-- in. Read-only.
CREATE VIEW card_default_printings AS
SELECT DISTINCT ON (p.card_id)
  p.card_id,
  p.id,
  p.image_uris,
  p.prices
FROM printings p
JOIN sets s ON s.id = p.set_id
WHERE s.set_type <> 'token' AND p.promo IS NOT TRUE AND 'nonfoil' = ANY(p.finishes)
ORDER BY p.card_id, (s.code = 'lea'), p.released_at ASC NULLS LAST, p.collector_number ASC;

-- Goatbots MTGO sell prices, one row per MTGO catalog item (foil and nonfoil
-- versions of a printing have distinct ids). Reference data like cards/printings
-- (public read, no user writes); refreshed by scripts/ingest_goatbots_prices.py.
CREATE TABLE goatbots_prices (
  mtgo_id INT PRIMARY KEY,                    -- MTGO catalog id (printings.mtgo_id / mtgo_foil_id)
  tix NUMERIC(9,3) NOT NULL                   -- Goatbots sell price in event tickets (bulk sells at 0.002)
);

-- The lowest Goatbots sell price per oracle card across every MTGO version
-- (all printings, foil and nonfoil) — the cheapest way to buy the card on MTGO,
-- matching the headline price on a goatbots.com card page. Read-only.
CREATE VIEW card_mtgo_prices AS
SELECT p.card_id, MIN(g.tix) AS tix
FROM printings p
JOIN goatbots_prices g ON g.mtgo_id IN (p.mtgo_id, p.mtgo_foil_id)
GROUP BY p.card_id;

-- The cheapest printing per oracle card: the non-token printing with the lowest
-- nonfoil USD price (printings without a USD price are excluded, so a card only
-- appears if at least one printing is priced). Mirrors card_default_printings so
-- decklist pricing can offer a "cheapest to build" total alongside first-printing
-- prices, still one row per card. Read-only.
CREATE VIEW card_cheapest_printings AS
SELECT DISTINCT ON (p.card_id)
  p.card_id,
  p.id,
  p.prices
FROM printings p
JOIN sets s ON s.id = p.set_id
WHERE s.set_type <> 'token' AND p.prices->>'usd' IS NOT NULL
ORDER BY p.card_id, (p.prices->>'usd')::numeric ASC;
