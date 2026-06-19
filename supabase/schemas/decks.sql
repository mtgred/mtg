-- User-created deck lists. A deck belongs to one authenticated user and holds a
-- set of card entries split across boards (mainboard/sideboard/commander/maybe).
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  format VARCHAR(31) REFERENCES formats(code),     -- constructed format (formats.code)
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,        -- public decks are readable by anyone
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX decks_user_id_idx ON decks (user_id);

-- Card entries within a deck. References the oracle-level `cards` row (gameplay
-- identity, stable across printings); `printing_id` optionally pins a specific
-- printing for display (art/collector number). One row per (deck, card, board).
CREATE TABLE deck_cards (
  id BIGSERIAL PRIMARY KEY,
  deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id INT NOT NULL REFERENCES cards(id),
  printing_id UUID REFERENCES printings(id),       -- optional preferred printing for display
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  board VARCHAR(15) NOT NULL DEFAULT 'main'
    CHECK (board IN ('main', 'side', 'commander', 'maybe')),
  UNIQUE (deck_id, card_id, board)
);

CREATE INDEX deck_cards_deck_id_idx ON deck_cards (deck_id);
CREATE INDEX deck_cards_card_id_idx ON deck_cards (card_id);

-- Keep decks.updated_at current on any edit to the deck row.
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decks_set_updated_at
  BEFORE UPDATE ON decks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security. The frontend queries Postgres directly with the anon key,
-- so access control lives here: owners manage their own decks; public decks are
-- world-readable. deck_cards visibility/mutability follows the parent deck.
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public and own decks are viewable"
  ON decks FOR SELECT
  USING (is_public OR user_id = (SELECT auth.uid()));

CREATE POLICY "Users insert their own decks"
  ON decks FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users update their own decks"
  ON decks FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users delete their own decks"
  ON decks FOR DELETE
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Deck cards follow deck visibility"
  ON deck_cards FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM decks d
    WHERE d.id = deck_cards.deck_id
      AND (d.is_public OR d.user_id = (SELECT auth.uid()))
  ));

CREATE POLICY "Users manage cards in their own decks"
  ON deck_cards FOR ALL
  USING (EXISTS (
    SELECT 1 FROM decks d
    WHERE d.id = deck_cards.deck_id
      AND d.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM decks d
    WHERE d.id = deck_cards.deck_id
      AND d.user_id = (SELECT auth.uid())
  ));
