import { supabase } from "./supabase"
import type { Card, DeckBoard, ImageUris, Prices } from "./types"

// The oracle-card fields a decklist row needs to render and sort.
export type ListCard = Pick<Card, "id" | "name" | "mana_cost" | "cmc" | "type_line" | "color_identity">

// The entry shape shared by user decks and tournament decklists; pages may
// extend it with their own columns.
export type DeckEntry = {
  id: number
  quantity: number
  board: DeckBoard
  cards: ListCard | null
}

// card_id -> the first (earliest) printing: id for linking, url for images and
// the hover preview, usd for first-printing pricing, tix for MTGO pricing.
export type Printings = Record<number, { id: string; url?: string; usd: number | null; tix: number | null }>
// card_id -> the cheapest printing (id for linking, usd) for "cheapest" pricing.
export type Cheapest = Record<number, { id: string; usd: number | null }>

// Boards in display order; boards with no entries are skipped.
export const BOARDS: { key: DeckBoard; label: string }[] = [
  { key: "commander", label: "Commander" },
  { key: "main", label: "Mainboard" },
  { key: "side", label: "Sideboard" },
  { key: "maybe", label: "Maybeboard" },
]

// Card supertypes grouped within a board, in display order; a card is filed
// under the first type its type line contains.
export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"]

export function categoryOf(typeLine: string | null | undefined): string {
  const t = typeLine ?? ""
  for (const cat of TYPE_ORDER) {
    if (cat !== "Other" && t.includes(cat)) return cat
  }
  return "Other"
}

// Basic lands (incl. snow basics) are effectively free, so pricing skips them.
export function isBasicLand(typeLine: string | null | undefined): boolean {
  return (typeLine ?? "").includes("Basic")
}

// A Scryfall price string as a number, or null when absent/unparseable.
function parseNum(value: string | null | undefined): number | null {
  const n = value != null ? Number(value) : NaN
  return Number.isNaN(n) ? null : n
}

// Oracle cards have no art, so grab one representative printing per card from
// the card_default_printings view (one row per card, so it stays under the API
// row cap). Keep the printing id for linking even when it carries no image.
// card_cheapest_printings gives the lowest-USD printing per card for pricing.
export async function loadPrintings(cardIds: number[]): Promise<{ printings: Printings; cheapest: Cheapest }> {
  const printings: Printings = {}
  const cheapest: Cheapest = {}
  if (cardIds.length === 0) return { printings, cheapest }
  const [{ data: imgs, error: iErr }, { data: cheap, error: cErr }] = await Promise.all([
    supabase.from("card_default_printings").select("id,card_id,image_uris,prices").in("card_id", cardIds),
    supabase.from("card_cheapest_printings").select("id,card_id,prices").in("card_id", cardIds),
  ])
  if (iErr) throw iErr
  if (cErr) throw cErr
  for (const row of (imgs ?? []) as unknown as {
    id: string
    card_id: number
    image_uris: ImageUris | null
    prices: Prices | null
  }[]) {
    printings[row.card_id] = {
      id: row.id,
      url: row.image_uris?.normal ?? row.image_uris?.large ?? row.image_uris?.small,
      usd: parseNum(row.prices?.usd),
      tix: parseNum(row.prices?.tix),
    }
  }
  for (const row of (cheap ?? []) as unknown as { id: string; card_id: number; prices: Prices | null }[]) {
    cheapest[row.card_id] = { id: row.id, usd: parseNum(row.prices?.usd) }
  }
  return { printings, cheapest }
}
