import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Card, Printing } from "../lib/types"
import { titleCase } from "../lib/format"

type Row = Pick<Printing, "id" | "collector_number" | "rarity" | "image_uris" | "illustration_id" | "released_at"> & {
  cards: Pick<Card, "id" | "name" | "type_line"> | null
}

type ArtistData = {
  name: string
  works: Row[]
  printingCount: number
}

async function loadArtist(name: string): Promise<ArtistData> {
  const { data, error } = await supabase
    .from("printings")
    .select("id,collector_number,rarity,image_uris,illustration_id,released_at,cards(id,name,type_line)")
    .eq("artist", name)
    .order("released_at", { ascending: true, nullsFirst: false })
  if (error) throw error

  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === 0) throw new Error(`No cards found for artist “${name}”.`)

  // Collapse reprints that share the same artwork so each distinct illustration
  // shows once; printings without an illustration id are kept individually.
  const seen = new Set<string>()
  const works: Row[] = []
  for (const row of rows) {
    const key = row.illustration_id ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    works.push(row)
  }

  return { name, works, printingCount: rows.length }
}

export default function ArtistPage() {
  const { name = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadArtist(name), [name])

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/artists">Artists</Link> <span className="sep">/</span> <span>{name}</span>
      </p>

      {error && (
        <>
          <p className="error">{error}</p>
          <p>
            <Link to="/artists">← Back to artists</Link>
          </p>
        </>
      )}
      {loading && <p className="muted">Loading cards…</p>}

      {data && (
        <>
          <header className="set-head">
            <div>
              <h1>{data.name}</h1>
              <p className="set-head-meta">
                <span>{data.works.length.toLocaleString()} illustrations</span>
                <span>{data.printingCount.toLocaleString()} printings</span>
              </p>
            </div>
          </header>

          <ul className="card-grid">
            {data.works.map(row => (
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
        </>
      )}
    </div>
  )
}
