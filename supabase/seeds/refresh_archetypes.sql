-- Populate the materialized archetype classifier (supabase/schemas/archetypes.sql).
-- The migrations create it before any seed has run, so it is built empty; this
-- runs last, once the tournament fixture is in place. Loaded last on purpose —
-- keep it at the end of db.seed.sql_paths in supabase/config.toml.
refresh materialized view tournament_deck_archetypes;
