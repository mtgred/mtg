-- Per-format metagame archetype classifier. `archetypes` is curated reference
-- data (see supabase/seeds/archetypes.sql), public read-only like formats/cards:
-- no row-level security, populated from the committed seed rather than by users.
--
-- A finishing deck is labeled by matching its main/commander card list against
-- each archetype's `signature_cards`; the best match wins (tournament_deck_archetypes).
-- This normalizes the inconsistent free-text `tournament_decks.archetype` labels
-- that ingest sources report (tcdecks-style classification).
CREATE TABLE archetypes (
  id BIGSERIAL PRIMARY KEY,
  format VARCHAR(31) NOT NULL REFERENCES formats(code),  -- formats.code
  name VARCHAR(255) NOT NULL,                             -- display label, e.g. "Izzet Murktide"
  sort_order INT,
  -- Defining cards by exact cards.name. A deck qualifies when it contains at
  -- least `min_signatures` of these in its main/commander boards.
  signature_cards TEXT[] NOT NULL,
  -- Null means "require all signature_cards". Set to 1 when a single card is
  -- decisive (e.g. Living End), or a lower count for partial-match shells.
  min_signatures INT,
  UNIQUE (format, name)
);

CREATE INDEX archetypes_format_idx ON archetypes (format);

-- Best-matching archetype per finishing deck. For every (deck, archetype) of the
-- deck's format, count how many of the archetype's signature cards appear in the
-- deck's main/commander boards; keep matches meeting the threshold, then pick the
-- strongest per deck (most signatures matched, then the most specific definition).
CREATE VIEW tournament_deck_archetypes AS
WITH matches AS (
  SELECT
    td.id AS tournament_deck_id,
    a.id AS archetype_id,
    a.name AS archetype,
    a.sort_order,
    array_length(a.signature_cards, 1) AS sig_count,
    count(DISTINCT sig.card) AS matched
  FROM tournament_decks td
  JOIN tournaments t ON t.id = td.tournament_id
  JOIN archetypes a ON a.format = t.format
  CROSS JOIN LATERAL unnest(a.signature_cards) AS sig(card)
  JOIN tournament_deck_cards tdc
    ON tdc.tournament_deck_id = td.id AND tdc.board IN ('main', 'commander')
  JOIN cards c ON c.id = tdc.card_id AND c.name = sig.card
  GROUP BY td.id, a.id
  HAVING count(DISTINCT sig.card) >= coalesce(a.min_signatures, array_length(a.signature_cards, 1))
)
SELECT DISTINCT ON (tournament_deck_id)
  tournament_deck_id, archetype_id, archetype
FROM matches
ORDER BY tournament_deck_id, matched DESC, sig_count DESC, sort_order NULLS LAST;

-- Flattened feed the metagame UI reads: one row per finishing deck with its
-- resolved archetype (classifier first, reported free-text label as fallback)
-- and tournament context, so the frontend filters by `format` without embedding.
CREATE VIEW meta_decks AS
SELECT
  td.id,
  td.tournament_id,
  td.player,
  td.placement,
  td.wins,
  td.losses,
  td.draws,
  coalesce(cl.archetype, td.archetype) AS archetype,
  td.archetype AS reported_archetype,
  cl.archetype_id,
  t.format,
  t.name AS tournament_name,
  t.held_on AS tournament_held_on
FROM tournament_decks td
JOIN tournaments t ON t.id = td.tournament_id
LEFT JOIN tournament_deck_archetypes cl ON cl.tournament_deck_id = td.id;
