import { Link } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Format } from "../lib/types"

type FormatSummary = Pick<Format, "code" | "name" | "description">

async function loadFormats(): Promise<FormatSummary[]> {
  const { data, error } = await supabase
    .from("formats")
    .select("code,name,sort_order,description")
    .order("sort_order", { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as FormatSummary[]
}

export default function FormatsPage() {
  const { data: formats, loading, error } = useAsync(loadFormats, [])

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          Formats <span className="page-head-count">{formats ? formats.length.toLocaleString() : ""}</span>
        </h1>
      </header>

      {loading && <p className="muted">Loading formats…</p>}
      {error && <p className="error">{error}</p>}

      {formats && formats.length > 0 && (
        <ul className="set-grid">
          {formats.map(format => (
            <li key={format.code}>
              <Link to={`/formats/${format.code}`} className="set-card">
                <span className="set-card-body">
                  <span className="set-name">{format.name}</span>
                  {format.description && <span className="set-card-desc">{format.description}</span>}
                  <span className="set-meta">
                    <span className="code-badge">{format.code}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {formats && formats.length === 0 && !loading && <p className="muted">No formats found.</p>}
    </div>
  )
}
