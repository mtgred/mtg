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
