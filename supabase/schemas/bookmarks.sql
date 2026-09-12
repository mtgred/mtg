-- Tournament decklists a signed-in user saved for later. Unlike the tournament
-- reference data it hangs off, this table is user-written, so it is RLS-guarded:
-- a bookmark is private to its owner, who is the only one able to read or change
-- it. One row per (user, decklist).
CREATE TABLE tournament_deck_bookmarks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_deck_id BIGINT NOT NULL REFERENCES tournament_decks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tournament_deck_id)
);

-- Listing a user's bookmarks, newest first.
CREATE INDEX tournament_deck_bookmarks_user_idx
  ON tournament_deck_bookmarks (user_id, created_at DESC);

ALTER TABLE tournament_deck_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own bookmarks"
  ON tournament_deck_bookmarks FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
