import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { useAuth } from "../lib/auth"
import type { Deck, Format } from "../lib/types"
import { formatDate } from "../lib/format"

// A deck row plus the aggregate count of its card entries (PostgREST returns the
// embedded count as a single-element array).
type DeckListItem = Pick<Deck, "id" | "name" | "format" | "is_public" | "updated_at"> & {
  deck_cards: { count: number }[]
}

type DecksData = {
  decks: DeckListItem[]
  formats: Format[]
}

async function loadDecks(userId: string): Promise<DecksData> {
  const { data: decks, error } = await supabase
    .from("decks")
    .select("id,name,format,is_public,updated_at,deck_cards(count)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
  if (error) throw error

  const { data: formats, error: fErr } = await supabase
    .from("formats")
    .select("code,name,sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false })
  if (fErr) throw fErr

  return { decks: (decks ?? []) as DeckListItem[], formats: (formats ?? []) as Format[] }
}

export default function DecksPage() {
  const { user } = useAuth()
  const userId = user!.id
  const navigate = useNavigate()
  const { data, loading, error } = useAsync(() => loadDecks(userId), [userId])

  const [name, setName] = useState("")
  const [format, setFormat] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function createDeck(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    setCreateError(null)
    const { data: row, error } = await supabase
      .from("decks")
      .insert({ user_id: userId, name: trimmed, format: format || null })
      .select("id")
      .single()
    setCreating(false)
    if (error || !row) {
      setCreateError(error?.message ?? "Could not create the deck.")
      return
    }
    navigate(`/decks/${row.id}`)
  }

  const formats = data?.formats ?? []
  const formatName = (code: string | null) => formats.find(f => f.code === code)?.name ?? code

  return (
    <div className="page">
      <header className="deck-list-head">
        <h1>
          Your decks{" "}
          <span className="page-head-count">{data ? data.decks.length.toLocaleString() : ""}</span>
        </h1>
      </header>

      <form className="deck-create" onSubmit={createDeck}>
        <label className="deck-create-field">
          <span className="field-label">Deck name</span>
          <input
            className="search"
            type="text"
            placeholder="Untitled deck"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={255}
          />
        </label>
        <label className="deck-create-field">
          <span className="field-label">Format</span>
          <select className="input" value={format} onChange={e => setFormat(e.target.value)}>
            <option value="">No format</option>
            {formats.map(f => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "New deck"}
        </button>
        {createError && <p className="error w-full">{createError}</p>}
      </form>

      {loading && <p className="muted">Loading decks…</p>}
      {error && <p className="error">{error}</p>}

      {data && data.decks.length > 0 && (
        <ul className="set-grid">
          {data.decks.map(deck => {
            const count = deck.deck_cards[0]?.count ?? 0
            return (
              <li key={deck.id}>
                <Link to={`/decks/${deck.id}`} className="set-card">
                  <span className="set-card-body">
                    <span className="set-name">{deck.name}</span>
                    <span className="set-meta">
                      {deck.format && <span className="code-badge">{formatName(deck.format)}</span>}
                      <span>
                        {count} {count === 1 ? "card" : "cards"}
                      </span>
                      {deck.is_public && <span className="deck-public-tag">Public</span>}
                      <span>Updated {formatDate(deck.updated_at.slice(0, 10))}</span>
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {data && data.decks.length === 0 && !loading && (
        <p className="muted">No decks yet. Name one above to get started.</p>
      )}
    </div>
  )
}
