// Mirrors the database schema in supabase/schemas. Only the fields the UI reads
// are typed; columns we never touch are intentionally omitted.

export type Set = {
  id: number
  code: string
  name: string
  set_type: string | null
  released_at: string | null
  block: string | null
  parent_set_code: string | null
  card_count: number | null
  digital: boolean | null
  icon_svg_uri: string | null
  scryfall_uri: string | null
}

export type Card = {
  id: number
  oracle_id: string
  name: string
  mana_cost: string | null
  cmc: number | null
  type_line: string | null
  oracle_text: string | null
  colors: string[] | null
  color_identity: string[] | null
  keywords: string[] | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  reserved: boolean | null
  legalities: Record<string, string> | null
  edhrec_rank: number | null
}

// One row per artist credit, from the `artists` view (supabase/schemas/artists.sql).
export type Artist = {
  name: string
  card_count: number
  printing_count: number
}

export type ImageUris = {
  small?: string
  normal?: string
  large?: string
  png?: string
  art_crop?: string
  border_crop?: string
}

export type Prices = {
  usd?: string | null
  usd_foil?: string | null
  usd_etched?: string | null
  eur?: string | null
  eur_foil?: string | null
  tix?: string | null
}

// A constructed format a deck can target (supabase/schemas/formats.sql).
export type Format = {
  code: string
  name: string
  sort_order: number | null
  description: string | null
  banned_cards: string[] | null
  restricted_cards: string[] | null
}

// A user-created deck list (supabase/schemas/decks.sql).
export type Deck = {
  id: string
  user_id: string
  name: string
  format: string | null
  description: string | null
  is_public: boolean
  created_at: string
  updated_at: string
}

export type DeckBoard = "main" | "side" | "commander" | "maybe"

// A card entry within a deck (supabase/schemas/decks.sql).
export type DeckCard = {
  id: number
  deck_id: string
  card_id: number
  printing_id: string | null
  quantity: number
  board: DeckBoard
}

// A competitive event whose results are tracked (supabase/schemas/tournaments.sql).
export type Tournament = {
  id: number
  name: string
  format: string | null
  held_on: string | null
  location: string | null
  source_url: string | null
  player_count: number | null
}

// A per-format metagame archetype definition (supabase/schemas/archetypes.sql).
export type Archetype = {
  id: number
  format: string
  name: string
  sort_order: number | null
  signature_cards: string[]
}

// One player's finish at a tournament, plus the deck they played.
export type TournamentDeck = {
  id: number
  tournament_id: number
  player: string
  archetype: string | null
  placement: number | null
  wins: number | null
  losses: number | null
  draws: number | null
}

// A card entry within a finishing deck (supabase/schemas/tournaments.sql).
export type TournamentDeckCard = {
  id: number
  tournament_deck_id: number
  card_id: number
  quantity: number
  board: DeckBoard
}

export type Printing = {
  id: string
  card_id: number
  set_id: number
  rarity: string
  artist: string | null
  illustration_id: string | null
  collector_number: string | null
  lang: string
  released_at: string | null
  border_color: string | null
  frame: string | null
  flavor_text: string | null
  full_art: boolean | null
  promo: boolean | null
  reprint: boolean | null
  digital: boolean | null
  finishes: string[] | null
  image_uris: ImageUris | null
  prices: Prices | null
  scryfall_uri?: string | null
}
