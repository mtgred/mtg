-- Per-format metagame archetype classifier. `archetypes` is curated reference
-- data seeded from supabase/seeds/archetypes.sql and editable in-app at
-- /:format/archetypes (RLS below: world-readable, signed-in users curate).
--
-- A finishing deck is labeled by matching its main/commander card list against
-- each archetype's `signature_cards` (requiring every `required_cards` and
-- rejecting it on any `excluded_cards`); the best match wins
-- (tournament_deck_archetypes).
-- This normalizes the inconsistent free-text `tournament_decks.archetype` labels
-- that ingest sources report (tcdecks-style classification).
CREATE TABLE archetypes (
  id BIGSERIAL PRIMARY KEY,
  format VARCHAR(31) NOT NULL REFERENCES formats(code),  -- formats.code
  name VARCHAR(255) NOT NULL,                             -- display label, e.g. "Izzet Murktide"
  sort_order INT,
  -- Defining cards by exact cards.name. A deck qualifies when its
  -- main/commander boards hold at least `min_signatures` of these plus
  -- `required_cards`.
  signature_cards TEXT[] NOT NULL,
  -- Threshold over signature_cards *and* required_cards together. Null means
  -- "require all of them". Set to 1 when a single card is decisive (e.g. Living
  -- End), or a lower count for partial-match shells.
  min_signatures INT,
  -- Prerequisites by exact cards.name: a deck must play *every* one of these to
  -- get this archetype, on top of clearing the threshold (which they count
  -- towards).
  required_cards TEXT[] NOT NULL DEFAULT '{}',
  -- Disqualifiers by exact cards.name: a deck playing any of these never gets
  -- this archetype, however many signatures it matched. Use to split shells that
  -- share a core (e.g. plain Tron excluding the Eldrazi payoffs).
  excluded_cards TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (format, name)
);

CREATE INDEX archetypes_format_idx ON archetypes (format);

-- The rules are curated collaboratively from the archetype-rules page. There is
-- no admin role, so any signed-in user may edit; anonymous visitors only read.
ALTER TABLE archetypes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Archetypes are viewable by everyone"
  ON archetypes FOR SELECT
  USING (true);

CREATE POLICY "Signed-in users manage archetypes"
  ON archetypes FOR ALL
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- Best-matching archetype per finishing deck. Every card any rule names is
-- resolved to a cards.id once (`rule_cards`, tagged with the role it plays), so
-- a single grouped pass over each deck's main/commander cards answers all three
-- tests at once: enough signature/required cards matched, every required card
-- present, no excluded card present. Ties are broken per deck by most cards
-- matched, then the most specific definition.
-- Materialized: classifying every deck costs a pass over the rule cards of all
-- 2.6M deck-card rows (~0.7s), and the metagame pages read this on every request.
-- It is refreshed whenever the rules change (trigger below) and at the end of a
-- tournament ingest (scripts/ingest_tournaments.py) — nothing else changes the
-- outcome, so the snapshot is only ever as stale as the last write to either.
CREATE MATERIALIZED VIEW tournament_deck_archetypes AS
WITH rules AS MATERIALIZED (
  -- Sizes count distinct names, so a name repeated in a list can't make a rule
  -- unsatisfiable. A name absent from `cards` resolves to no card_id and so
  -- never matches — for a required card that disables the rule entirely.
  SELECT
    a.id, a.name, a.sort_order, a.min_signatures,
    -- `card_count` is what a blank min_signatures means: every named card. A name
    -- in both lists is counted once per role here and matches once per role
    -- below, so the two stay consistent.
    (SELECT count(DISTINCT s) FROM unnest(a.signature_cards) s)
      + (SELECT count(DISTINCT r) FROM unnest(a.required_cards) r) AS card_count,
    (SELECT count(DISTINCT r) FROM unnest(a.required_cards) r) AS req_count
  FROM archetypes a
),
rule_cards AS MATERIALIZED (
  SELECT DISTINCT a.id AS archetype_id, a.format, c.id AS card_id, r.role
  FROM archetypes a
  CROSS JOIN LATERAL (
    SELECT unnest(a.signature_cards) AS card, 'sig' AS role
    UNION ALL SELECT unnest(a.required_cards), 'req'
    UNION ALL SELECT unnest(a.excluded_cards), 'exc'
  ) r
  JOIN cards c ON c.name = r.card
),
-- Only the cards some rule cares about, one row per (deck, card) so the counts
-- below need no DISTINCT — a card listed on both main and commander counts once.
deck_cards AS MATERIALIZED (
  SELECT DISTINCT td.id AS tournament_deck_id, t.format, tdc.card_id
  FROM tournament_decks td
  JOIN tournaments t ON t.id = td.tournament_id
  JOIN tournament_deck_cards tdc
    ON tdc.tournament_deck_id = td.id AND tdc.board IN ('main', 'commander')
  WHERE EXISTS (SELECT 1 FROM rule_cards rc WHERE rc.card_id = tdc.card_id)
),
matches AS (
  SELECT
    dc.tournament_deck_id,
    rc.archetype_id,
    count(*) FILTER (WHERE rc.role IN ('sig', 'req')) AS matched,
    count(*) FILTER (WHERE rc.role = 'req') AS required_matched,
    count(*) FILTER (WHERE rc.role = 'exc') AS excluded_hits
  FROM deck_cards dc
  JOIN rule_cards rc ON rc.format = dc.format AND rc.card_id = dc.card_id
  GROUP BY dc.tournament_deck_id, rc.archetype_id
)
SELECT DISTINCT ON (m.tournament_deck_id)
  m.tournament_deck_id, r.id AS archetype_id, r.name AS archetype
FROM matches m
JOIN rules r ON r.id = m.archetype_id
WHERE m.matched >= coalesce(r.min_signatures, r.card_count)
  AND m.required_matched = r.req_count
  AND m.excluded_hits = 0
ORDER BY m.tournament_deck_id, m.matched DESC, r.card_count DESC, r.sort_order NULLS LAST, r.id;

-- Unique key so the meta_decks join plans as a hash/merge join rather than a
-- nested loop, and so a CONCURRENTLY refresh is possible from outside a transaction.
CREATE UNIQUE INDEX tournament_deck_archetypes_deck_idx
  ON tournament_deck_archetypes (tournament_deck_id);

-- Rule edits from the archetype-rules page reclassify every deck in the format,
-- so the snapshot is rebuilt in the same transaction as the edit. SECURITY
-- DEFINER because the matview is owned by postgres, not by the signed-in editor.
CREATE FUNCTION refresh_tournament_deck_archetypes() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  REFRESH MATERIALIZED VIEW tournament_deck_archetypes;
$$;

CREATE FUNCTION archetypes_refresh_matches() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW tournament_deck_archetypes;
  RETURN NULL;
END;
$$;

CREATE TRIGGER archetypes_refresh_matches
  AFTER INSERT OR UPDATE OR DELETE ON archetypes
  FOR EACH STATEMENT EXECUTE FUNCTION archetypes_refresh_matches();

-- Flattened feed the metagame UI reads: one row per finishing deck with its
-- resolved archetype and tournament context, so the frontend filters by `format`
-- without embedding. The classifier wins; the source's reported free-text label
-- is only kept when it names a curated archetype of the format (matched
-- case-insensitively, displayed with the curated casing). Anything else — a
-- source-specific label like "W" with no rule behind it — resolves to NULL, which
-- the UI shows as "Other".
CREATE VIEW meta_decks AS
SELECT
  td.id,
  td.tournament_id,
  td.player,
  td.placement,
  td.wins,
  td.losses,
  td.draws,
  coalesce(cl.archetype, named.name) AS archetype,
  td.archetype AS reported_archetype,
  cl.archetype_id,
  t.format,
  t.name AS tournament_name,
  t.held_on AS tournament_held_on
FROM tournament_decks td
JOIN tournaments t ON t.id = td.tournament_id
LEFT JOIN tournament_deck_archetypes cl ON cl.tournament_deck_id = td.id
LEFT JOIN archetypes named ON named.format = t.format AND lower(named.name) = lower(btrim(td.archetype));
