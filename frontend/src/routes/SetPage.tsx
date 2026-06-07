import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Card, Printing, Set } from "../lib/types"
import { compareCollector, formatDate, titleCase } from "../lib/format"

type Row = Pick<Printing, "id" | "collector_number" | "rarity" | "image_uris" | "promo"> & {
  cards: Pick<Card, "id" | "name" | "type_line"> | null
}

type SetData = {
  set: Set
  rows: Row[]
}

async function loadSet(code: string): Promise<SetData> {
  const { data: set, error: setErr } = await supabase
    .from("sets")
    .select("id,code,name,set_type,released_at,block,parent_set_code,card_count,digital,icon_svg_uri,scryfall_uri")
    .eq("code", code)
    .maybeSingle()
  if (setErr) throw setErr
  if (!set) throw new Error(`Set “${code}” not found.`)

  const { data, error } = await supabase
    .from("printings")
    .select("id,collector_number,rarity,image_uris,promo,cards(id,name,type_line)")
    .eq("set_id", set.id)
    .order("collector_number")
  if (error) throw error

  const rows = ((data ?? []) as unknown as Row[])
    .slice()
    .sort((a, b) => compareCollector(a.collector_number, b.collector_number))

  return { set, rows }
}

export default function SetPage() {
  const { code = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadSet(code), [code])

  const set = data?.set

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/sets">Sets</Link> <span className="sep">/</span> <span>{set?.name ?? code}</span>
      </p>

      {set && (
        <header className="set-head">
          {set.icon_svg_uri && <img className="set-head-icon" src={set.icon_svg_uri} alt="" />}
          <div>
            <h1>{set.name}</h1>
            <p className="set-head-meta">
              <span className="code-badge">{set.code}</span>
              {set.set_type && <span>{titleCase(set.set_type)}</span>}
              {set.released_at && <span>{formatDate(set.released_at)}</span>}
              {set.card_count != null && <span>{set.card_count} cards</span>}
              {set.block && <span>{set.block} block</span>}
            </p>
          </div>
        </header>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading cards…</p>}

      {data && (
        <>
          <ul className="card-grid">
            {data.rows.map(row => (
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
