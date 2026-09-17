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
-- The archetype classifier looks up decks by the handful of card ids its rules
-- name, over main/commander only (see tournament_deck_archetypes).
CREATE INDEX tournament_deck_cards_card_id_idx
  ON tournament_deck_cards (card_id, tournament_deck_id)
  WHERE board IN ('main', 'commander');

-- Deck search by card list, for the metagame search tab. Each term matches any
-- card whose name contains it (case-insensitive, so "ragavan" finds "Ragavan,
-- Nimble Pilferer"); a deck qualifies only when *every* term hits, main terms
-- over main/commander and side terms over the sideboard. With p_any a single
-- hit suffices instead, which the exclusion boxes use to find decks to drop.
-- Returns the matching `tournament_decks.id`s as one array — the page already
-- holds the format's finishes in memory and only needs the id set to intersect,
-- and an array sidesteps PostgREST's row cap on a term as common as Lightning Bolt.
CREATE FUNCTION meta_deck_search(p_format TEXT, p_main TEXT[] DEFAULT '{}', p_side TEXT[] DEFAULT '{}', p_any BOOLEAN DEFAULT false)
RETURNS BIGINT[]
LANGUAGE sql STABLE
AS $$
  WITH terms AS (
    SELECT DISTINCT board, lower(btrim(t)) AS term
    FROM (SELECT 'main' AS board, unnest(p_main) AS t
          UNION ALL SELECT 'side', unnest(p_side)) s
    WHERE btrim(t) <> ''
  ),
  hits AS (
    SELECT t.board, t.term, tdc.tournament_deck_id
    FROM terms t
    JOIN cards c ON c.name ILIKE '%' || t.term || '%'
    JOIN tournament_deck_cards tdc ON tdc.card_id = c.id
     AND tdc.board = ANY (CASE WHEN t.board = 'main' THEN ARRAY['main', 'commander'] ELSE ARRAY['side'] END)
    GROUP BY 1, 2, 3
  )
  SELECT coalesce(array_agg(h.tournament_deck_id), '{}')
  FROM (
    SELECT tournament_deck_id FROM hits
    GROUP BY 1 HAVING p_any OR count(*) = (SELECT count(*) FROM terms)
  ) h
  JOIN tournament_decks td ON td.id = h.tournament_deck_id
  JOIN tournaments t ON t.id = td.tournament_id AND t.format = p_format;
$$;
