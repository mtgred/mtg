// Shared display helpers.

import type { Prices } from "./types"

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso + "T00:00:00")
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { year: "2-digit", month: "2-digit", day: "2-digit" })
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return ""
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

// Natural sort for collector numbers like "1", "10", "2", "140a", "★123".
export function compareCollector(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true, sensitivity: "base" })
}

export function formatPrice(usd: string | null | undefined): string | null {
  if (!usd) return null
  const n = Number(usd)
  if (Number.isNaN(n)) return null
  return `$${n.toFixed(2)}`
}

export function formatTix(tix: string | null | undefined): string | null {
  if (!tix) return null
  const n = Number(tix)
  if (Number.isNaN(n)) return null
  // Goatbots prices bulk at 0.002 tix; keep the third decimal rather than show 0.00.
  return `${n.toFixed(n > 0 && n < 0.01 ? 3 : 2)} tix`
}

function money(value: string | null | undefined, symbol: string): string | null {
  if (!value) return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  return `${symbol}${n.toFixed(2)}`
}

// Every price a printing carries, labeled, skipping any that are missing.
export function listPrices(prices: Prices | null | undefined): { label: string; value: string }[] {
  if (!prices) return []
  const entries: [string, string | null][] = [
    ["USD", money(prices.usd, "$")],
    ["Foil", money(prices.usd_foil, "$")],
    ["Etched", money(prices.usd_etched, "$")],
    ["EUR", money(prices.eur, "€")],
    ["EUR Foil", money(prices.eur_foil, "€")],
    ["Tix", prices.tix ? `${prices.tix} tix` : null],
  ]
  return entries.filter((e): e is [string, string] => e[1] != null).map(([label, value]) => ({ label, value }))
}
