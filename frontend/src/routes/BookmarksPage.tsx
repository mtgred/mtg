import { useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { useSort } from "../lib/useSort"
import { SortTh } from "../components/SortTh"
import { useAuth } from "../lib/auth"
import { formatDate } from "../lib/format"

// A saved decklist, flattened from the bookmark row and its meta_decks entry
type Bookmark = {
  deckId: number
  savedAt: string
  tournamentId: number
  format: string | null
  archetype: string | null
  player: string
  placement: number | null
  playerCount: number | null
  wins: number | null
  losses: number | null
  draws: number | null
  tournamentName: string | null
  heldOn: string | null
}

// A deck's match record as "w–l–d", or null when unrecorded.
function record(b: Bookmark): string | null {
  if (b.wins == null && b.losses == null && b.draws == null) return null
  return [b.wins ?? 0, b.losses ?? 0, b.draws ?? 0].join("–")
}

async function loadBookmarks(): Promise<Bookmark[]> {
  // RLS scopes the table to the signed-in owner, so no user filter is needed
  const { data: rows, error } = await supabase
    .from("tournament_deck_bookmarks")
    .select("tournament_deck_id,created_at")
    .order("created_at", { ascending: false })
  if (error) throw error
  if (!rows?.length) return []

  // meta_decks carries the resolved archetype plus the tournament columns, so one lookup covers everything the table shows
  // Fetched separately rather than embedded — it is a view, and the bookmark order is what drives the list
  const ids = rows.map(r => r.tournament_deck_id as number)
  const { data: decks, error: dErr } = await supabase
    .from("meta_decks")
    .select("id,tournament_id,player,placement,wins,losses,draws,archetype,format,tournament_name,tournament_held_on")
    .in("id", ids)
  if (dErr) throw dErr

  // meta_decks stops at the tournament's name and date, so the field size comes from `tournaments` — it is what turns a placement into "3/128"
  const { data: tournaments, error: tErr } = await supabase
    .from("tournaments")
    .select("id,player_count")
    .in("id", [...new Set((decks ?? []).map(d => d.tournament_id as number))])
  if (tErr) throw tErr
  const counts = new Map((tournaments ?? []).map(t => [t.id as number, t.player_count as number | null]))

  const byId = new Map((decks ?? []).map(d => [d.id as number, d]))
  return rows.flatMap(r => {
    const d = byId.get(r.tournament_deck_id as number)
    if (!d) return []
    return [{
      deckId: d.id as number,
      savedAt: r.created_at as string,
      tournamentId: d.tournament_id as number,
      format: d.format as string | null,
      archetype: d.archetype as string | null,
      player: d.player as string,
      placement: d.placement as number | null,
      playerCount: counts.get(d.tournament_id as number) ?? null,
      wins: d.wins as number | null,
      losses: d.losses as number | null,
      draws: d.draws as number | null,
      tournamentName: d.tournament_name as string | null,
      heldOn: d.tournament_held_on as string | null,
    }]
  })
}

const bookmarkSort = {
  date: (b: Bookmark) => b.heldOn,
  saved: (b: Bookmark) => b.savedAt,
}

export default function BookmarksPage() {
  const { user } = useAuth()
  const userId = user!.id
  const { data, loading, error } = useAsync(loadBookmarks, [userId])
  // Decks unbookmarked since the load, hidden without a refetch
  const [removed, setRemoved] = useState<number[]>([])
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function remove(deckId: number) {
    setRemoveError(null)
    const { error } = await supabase
      .from("tournament_deck_bookmarks")
      .delete()
      .eq("tournament_deck_id", deckId)
    if (error) setRemoveError(error.message)
    else setRemoved(ids => [...ids, deckId])
  }

  const bookmarks = (data ?? []).filter(b => !removed.includes(b.deckId))
  const { sorted, sort, toggle } = useSort(bookmarks, bookmarkSort, { key: "saved", dir: "desc" })

  return (
    <div className="page">
      <header className="deck-list-head">
        <h1>
          Bookmarks <span className="page-head-count">{data ? bookmarks.length.toLocaleString() : ""}</span>
        </h1>
      </header>

      {loading && <p className="muted">Loading bookmarks…</p>}
      {error && <p className="error">{error}</p>}
      {removeError && <p className="error">{removeError}</p>}

      {data && bookmarks.length === 0 && !loading &&
        <p className="muted">
          No bookmarks yet. Open a tournament decklist and hit Bookmark to save it here.
        </p>}

      {bookmarks.length > 0 &&
        <table className="standings">
          <thead>
            <tr>
              <th className="standings-rank">Rank</th>
              <th className="standings-record">Record</th>
              <th>Deck</th>
              <th>Player</th>
              <SortTh col="date" sort={sort} toggle={toggle} className="standings-record">
                Date
              </SortTh>
              <th>Tournament</th>
              <SortTh col="saved" sort={sort} toggle={toggle} className="standings-record">
                Saved
              </SortTh>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map(b => {
              const fmt = b.format || "modern"
              return (
                <tr key={b.deckId}>
                  <td className="standings-rank">
                    {b.placement ?? "—"}
                    {b.playerCount != null && `/${b.playerCount}`}
                  </td>
                  <td className="standings-record">{record(b) ?? "—"}</td>
                  <td>
                    <Link to={`/${fmt}/tournaments/${b.tournamentId}/decks/${b.deckId}`}>
                      {b.archetype ?? "Other"}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/${fmt}/search?player=${encodeURIComponent(b.player)}`}>{b.player}</Link>
                  </td>
                  <td className="standings-record">{b.heldOn ? formatDate(b.heldOn) : "—"}</td>
                  <td>
                    <Link to={`/${fmt}/tournaments/${b.tournamentId}`}>{b.tournamentName ?? "Tournament"}</Link>
                  </td>
                  <td className="standings-record">{formatDate(b.savedAt.slice(0, 10))}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="bg-transparent border-none p-0 cursor-pointer text-blue-600 hover:underline hover:underline-offset-2 hover:decoration-1"
                      onClick={() => remove(b.deckId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>}
    </div>
  )
}
