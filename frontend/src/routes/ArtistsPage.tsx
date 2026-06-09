import { useDeferredValue, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Artist } from "../lib/types"

// Escape ilike wildcards so a literal % or _ typed by the user is matched as-is.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

// With no query we browse the most prolific artists; a query searches every
// artist by name. The `artists` view can exceed the API row cap, so filtering
// happens server-side rather than over a client-side copy.
async function loadArtists(query: string): Promise<Artist[]> {
  const q = query.trim()
  let request = supabase.from("artists").select("name,card_count,printing_count")
  request = q
    ? request.ilike("name", `%${escapeLike(q)}%`).order("name").limit(200)
    : request.order("card_count", { ascending: false }).limit(120)
  const { data, error } = await request
  if (error) throw error
  return (data ?? []) as Artist[]
}

export default function ArtistsPage() {
  const [query, setQuery] = useState("")
  const deferred = useDeferredValue(query)
  const { data: artists, loading, error } = useAsync(() => loadArtists(deferred), [deferred])
  const searching = deferred.trim().length > 0

  return (
    <div className="page">
      <header className="page-head">
        <h1>Artists</h1>
        <input
          className="search"
          type="search"
          placeholder="Search artists by name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </header>

      {!searching && !loading && <p className="set-group-title">Most prolific</p>}

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading artists…</p>}

      {artists && artists.length > 0 && (
        <ul className="set-grid">
          {artists.map(artist => (
            <li key={artist.name}>
              <Link to={`/artists/${encodeURIComponent(artist.name)}`} className="set-card">
                <span className="set-card-body">
                  <span className="set-name">{artist.name}</span>
                  <span className="set-meta">
                    <span>{artist.card_count.toLocaleString()} cards</span>
                    <span>{artist.printing_count.toLocaleString()} printings</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {artists && artists.length === 0 && !loading && (
        <p className="muted">{searching ? `No artists match “${deferred.trim()}”.` : "No artists found."}</p>
      )}
    </div>
  )
}
