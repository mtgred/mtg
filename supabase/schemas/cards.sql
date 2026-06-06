-- Oracle-level (gameplay) data: identical across every printing of a card.
CREATE TABLE cards (
  id SERIAL PRIMARY KEY,
  oracle_id UUID NOT NULL UNIQUE,     -- Scryfall oracle_id: stable id for the gameplay card
  name VARCHAR(255) NOT NULL UNIQUE,
  mana_cost VARCHAR(63),              -- e.g. "{5}{G}{W}"
  cmc NUMERIC(9,1),                   -- mana value; fractional (0.5) and joke cards (Gleemax: 1000000)
  type_line VARCHAR(255),             -- e.g. "Creature — Cat Beast Spirit"
  oracle_text TEXT,
  colors TEXT[],                      -- e.g. {G,W}
  color_identity TEXT[],              -- colors for deck-building / Commander rules
  keywords TEXT[],                    -- e.g. {Trample}
  power VARCHAR(15),                  -- string: can be "*", "1+*", etc.
  toughness VARCHAR(15),
  loyalty VARCHAR(15),                -- planeswalkers; string for "X"/"*"
  reserved BOOLEAN,                   -- on the Reserved List
  legalities JSONB,                   -- format -> "legal"/"not_legal"/...
  edhrec_rank INT
);
