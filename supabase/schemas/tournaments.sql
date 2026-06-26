-- Competitive tournament results — the "deck meta tracker". Curated reference
-- data (see supabase/seeds/tournaments.sql), public read-only like sets/cards/
-- formats: no row-level security, populated from the committed seed rather than
-- by users.
--
-- Three levels, mirroring the user-deck shape:
--   tournaments        — one row per event, tied to a format
--   tournament_decks   — one row per player's finish (standing + record + the deck)
--   tournament_deck_cards — the card entries that make up each finishing deck
CREATE TABLE tournaments (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(31),                             -- ingest source, e.g. 'mtgo', 'melee' (null for curated samples)
  external_id VARCHAR(255),                       -- the event's id at that source; identity key for re-imports
  name VARCHAR(255) NOT NULL,
  format VARCHAR(31) REFERENCES formats(code),   -- constructed format (formats.code)
  held_on DATE,                                  -- date the event took place
  location VARCHAR(255),                          -- city / venue / "Online"
  source_url TEXT,                                -- link to coverage or results
  player_count INT,                              -- number of competitors
  -- (source, external_id) lets scripts/ingest_tournaments.py upsert an event
  -- idempotently instead of inserting duplicates on each periodic fetch.
  UNIQUE (source, external_id)
);

CREATE INDEX tournaments_format_idx ON tournaments (format);
CREATE INDEX tournaments_held_on_idx ON tournaments (held_on DESC);

-- One player's result at a tournament, plus the deck they played. `archetype`
-- is the metagame label (e.g. "Izzet Murktide"); the card-level list lives in
-- tournament_deck_cards and may be absent when only the archetype was reported.
CREATE TABLE tournament_decks (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player VARCHAR(255) NOT NULL,
  archetype VARCHAR(255),
  placement INT,                                  -- final standing, 1 = first
  wins INT,
  losses INT,
  draws INT
);

CREATE INDEX tournament_decks_tournament_id_idx ON tournament_decks (tournament_id);

-- Card entries within a finishing deck. References the oracle-level `cards` row
-- (gameplay identity, stable across printings), mirroring deck_cards. Tournament
-- lists only use main/side/commander boards.
CREATE TABLE tournament_deck_cards (
  id BIGSERIAL PRIMARY KEY,
  tournament_deck_id BIGINT NOT NULL REFERENCES tournament_decks(id) ON DELETE CASCADE,
  card_id INT NOT NULL REFERENCES cards(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  board VARCHAR(15) NOT NULL DEFAULT 'main'
    CHECK (board IN ('main', 'side', 'commander')),
  UNIQUE (tournament_deck_id, card_id, board)
);

CREATE INDEX tournament_deck_cards_deck_id_idx ON tournament_deck_cards (tournament_deck_id);
