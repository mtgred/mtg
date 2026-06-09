-- Distinct card artists, derived from printings. One row per artist credit,
-- with how many unique cards and physical printings they have illustrated.
-- Read-only; there is no underlying artists table (Scryfall credits art as a
-- plain string on each printing).
CREATE VIEW artists AS
SELECT
  artist AS name,
  count(DISTINCT card_id)::int AS card_count,
  count(*)::int AS printing_count
FROM printings
WHERE artist IS NOT NULL AND artist <> ''
GROUP BY artist;
