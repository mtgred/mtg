import { BsArrowLeft } from "react-icons/bs"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Card, Format, Printing } from "../lib/types"
import { titleCase } from "../lib/format"

// One printing chosen to represent a card on a banned/restricted list, carrying
// just enough of the joined card for display and a link.
type Row = Pick<Printing, "id" | "collector_number" | "rarity" | "image_uris" | "card_id"> & {
  cards: Pick<Card, "id" | "name" | "type_line"> | null
}

type FormatData = {
  format: Format
  legalCount: number
  banned: Row[]
  restricted: Row[]
}

// Collapse printings to one per card (earliest printing first), then sort by card
// name, so each banned or restricted card shows its original printing once.
function dedupeByCard(rows: Row[]): Row[] {
  const seen = new Set<number>()
  const out: Row[] = []
  for (const row of rows) {
    if (seen.has(row.card_id)) continue
    seen.add(row.card_id)
    out.push(row)
  }
  out.sort((a, b) => (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""))
  return out
}

// Cards with the given Scryfall legality status in this format. Used for official
// formats, where the `legalities` column is authoritative.
async function loadByStatus(code: string, status: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from("printings")
    .select("id,collector_number,rarity,image_uris,card_id,cards!inner(id,name,type_line,legalities)")
    .eq(`cards.legalities->>${code}`, status)
    .order("released_at", { ascending: true, nullsFirst: false })
  if (error) throw error
  return dedupeByCard((data ?? []) as unknown as Row[])
}

// Cards named by a curated override list. Used for community formats whose
// banned/restricted lists Scryfall doesn't track accurately (e.g. Old School).
async function loadByNames(names: string[]): Promise<Row[]> {
  if (names.length === 0) return []
  const { data, error } = await supabase
    .from("printings")
    .select("id,collector_number,rarity,image_uris,card_id,cards!inner(id,name,type_line)")
    .in("cards.name", names)
    .order("released_at", { ascending: true, nullsFirst: false })
  if (error) throw error
  return dedupeByCard((data ?? []) as unknown as Row[])
}

async function loadFormat(code: string): Promise<FormatData> {
  const { data, error } = await supabase
    .from("formats")
    .select("code,name,sort_order,description,banned_cards,restricted_cards")
    .eq("code", code)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Unknown format “${code}”.`)
  const format = data as Format

  // Prefer a curated override list when present (community formats); otherwise
  // derive the list from each card's Scryfall legality.
  const [{ count, error: cErr }, banned, restricted] = await Promise.all([
    supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq(`legalities->>${code}`, "legal"),
    format.banned_cards ? loadByNames(format.banned_cards) : loadByStatus(code, "banned"),
    format.restricted_cards ? loadByNames(format.restricted_cards) : loadByStatus(code, "restricted"),
  ])
  if (cErr) throw cErr

  return { format, legalCount: count ?? 0, banned, restricted }
}

export default function FormatPage() {
  const { code = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadFormat(code), [code])

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/formats">Formats</Link> <span className="sep">/</span>{" "}
        <span>{data?.format.name ?? code}</span>
      </p>

      {error && (
        <>
          <p className="error">{error}</p>
          <p>
            <Link to="/formats"><BsArrowLeft className="inline" /> Back to formats</Link>
          </p>
        </>
      )}
      {loading && <p className="muted">Loading format…</p>}

      {data && (
        <>
          <header className="set-head">
            <div>
              <h1>{data.format.name}</h1>
              <p className="set-head-meta">
                <span>{data.legalCount.toLocaleString()} legal cards</span>
                {data.banned.length > 0 && <span>{data.banned.length.toLocaleString()} banned</span>}
                {data.restricted.length > 0 && <span>{data.restricted.length.toLocaleString()} restricted</span>}
              </p>
            </div>
          </header>

          {data.format.description && <p className="format-blurb">{data.format.description}</p>}

          <CardSection title="Banned" status="banned" rows={data.banned} />
          <CardSection title="Restricted" status="restricted" rows={data.restricted} />

          {data.banned.length === 0 && data.restricted.length === 0 && (
            <p className="muted">No cards are banned or restricted in {data.format.name}.</p>
          )}
        </>
      )}
    </div>
  )
}

function CardSection({ title, status, rows }: { title: string; status: string; rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <section className="set-group">
      <h2 className="set-group-title">
        <span className={`legality legality-${status}`}>{title}</span> {rows.length.toLocaleString()}
      </h2>
      <ul className="card-grid">
        {rows.map(row => (
          <li key={row.id}>
            <Link to={`/cards/${row.id}`} className="card-tile">
              <div className="card-img">
                {row.image_uris?.normal || row.image_uris?.small ? (
                  <img src={row.image_uris.normal ?? row.image_uris.small} alt={row.cards?.name ?? ""} loading="lazy" />
                ) : (
                  <div className="card-img-fallback">
                    <span>{row.cards?.name ?? "Card"}</span>
                  </div>
                )}
              </div>
              <div className="card-tile-info">
                <span className={`rarity-dot rarity-${row.rarity}`} title={titleCase(row.rarity)} />
                <span className="card-tile-name">{row.cards?.name ?? "Unknown"}</span>
                <span className="muted">#{row.collector_number}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
