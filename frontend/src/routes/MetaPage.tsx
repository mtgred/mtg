import { useMemo } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate } from "../lib/format"
import FilterInput from "../components/FilterInput"
import type { Format } from "../lib/types"

// A finishing deck within this format, carrying its tournament for context. The
// `archetype` here is classifier-resolved (see supabase/schemas/archetypes.sql),
// falling back to the reported label; comes flattened from the `meta_decks` view.
type MetaDeck = {
  id: number
  player: string
  archetype: string | null
  archetype_id: number | null
  placement: number | null
  wins: number | null
  losses: number | null
  draws: number | null
  tournament_id: number
  tournament_name: string | null
  tournament_held_on: string | null
}

type MetaTournament = {
  id: number
  name: string
  held_on: string | null
  location: string | null
  player_count: number | null
}

type MetaData = {
  format: Format | null
  tournaments: MetaTournament[]
  decks: MetaDeck[]
}

async function loadMeta(format: string): Promise<MetaData> {
  const { data: fmt } = await supabase.from("formats").select("code,name").eq("code", format).maybeSingle()

  const { data: tournaments, error: tErr } = await supabase
    .from("tournaments")
    .select("id,name,held_on,location,player_count")
    .eq("format", format)
    .order("held_on", { ascending: false, nullsFirst: false })
  if (tErr) throw tErr

  // Every recorded finish in this format, with its archetype already classified
  // and tournament context flattened in by the `meta_decks` view. Powers both
  // the archetype breakdown and the deck search.
  const { data: decks, error: dErr } = await supabase
    .from("meta_decks")
    .select(
      "id,player,archetype,archetype_id,placement,wins,losses,draws,tournament_id,tournament_name,tournament_held_on",
    )
    .eq("format", format)
    .order("placement", { ascending: true, nullsFirst: false })
  if (dErr) throw dErr

  return {
    format: (fmt as Format) ?? null,
    tournaments: (tournaments ?? []) as MetaTournament[],
    decks: (decks ?? []) as unknown as MetaDeck[],
  }
}

type Tab = "meta" | "tournaments" | "search"
const TABS: { id: Tab; label: string }[] = [
  { id: "meta", label: "Meta" },
  { id: "tournaments", label: "Tournaments" },
  { id: "search", label: "Search" },
]
const TAB_IDS = new Set<string>(TABS.map(t => t.id))
const NO_DECKS: MetaDeck[] = []

// A deck's match record as "w–l" (with draws appended), or null when unrecorded.
function record(d: MetaDeck): string | null {
  if (d.wins == null && d.losses == null && d.draws == null) return null
  return [d.wins ?? 0, d.losses ?? 0, d.draws ?? 0].join("–")
}

// Path for a tab within a format: /:format for Meta, /:format/:tab otherwise.
const tabPath = (format: string, id: Tab) => (id === "meta" ? `/${format}` : `/${format}/${id}`)

export default function MetaPage() {
  const { format = "", tab: tabParam } = useParams()
  const { data, loading, error } = useAsync(() => loadMeta(format), [format])
  // The search filter is URL-driven (?q=) so archetype rows can deep-link into a
  // pre-filtered deck list, tcdecks-style.
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get("q") ?? ""
  const setQuery = (v: string) => setSearchParams(v ? { q: v } : {}, { replace: true })

  const tab: Tab = tabParam && TAB_IDS.has(tabParam) ? (tabParam as Tab) : "meta"

  const decks = data?.decks ?? NO_DECKS

  // Archetype share across every finish, best placement broken out.
  const archetypes = useMemo(() => {
    const map = new Map<string, { name: string; count: number; wins: number; games: number }>()
    for (const d of decks) {
      const name = d.archetype ?? "Other"
      const e = map.get(name) ?? { name, count: 0, wins: 0, games: 0 }
      e.count++
      e.wins += d.wins ?? 0
      e.games += (d.wins ?? 0) + (d.losses ?? 0) + (d.draws ?? 0)
      map.set(name, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [decks])

  const deckCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const d of decks) m.set(d.tournament_id, (m.get(d.tournament_id) ?? 0) + 1)
    return m
  }, [decks])

  // tournament_id -> player_count, for showing "placement/players" in search.
  const playerCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of data?.tournaments ?? []) if (t.player_count != null) m.set(t.id, t.player_count)
    return m
  }, [data])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return decks
    return decks.filter(
      d => (d.archetype ?? "Other").toLowerCase().includes(q) || d.player.toLowerCase().includes(q),
    )
  }, [decks, query])

  const formatName = data?.format?.name ?? format

  // A single-segment path that isn't a known format code lands here; treat it as
  // not found rather than rendering an empty metagame.
  if (data && !data.format) {
    return (
      <div className="page">
        <p className="error">Unknown format “{format}”.</p>
        <p>
          <Link to="/formats">← Browse formats</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{formatName} Meta</h1>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <Link
            key={t.id}
            to={tabPath(format, t.id)}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " is-active" : ""}`}
          >
            {t.label}
            <span className="tab-count">
              {t.id === "meta" ? archetypes.length : t.id === "tournaments" ? data?.tournaments.length ?? 0 : decks.length}
            </span>
          </Link>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data && tab === "meta" && (
        <MetaTab archetypes={archetypes} total={decks.length} formatName={formatName} format={format} />
      )}
      {data && tab === "tournaments" && (
        <TournamentsTab tournaments={data.tournaments} counts={deckCounts} format={format} />
      )}
      {data && tab === "search" && (
        <SearchTab
          decks={matches}
          query={query}
          onQuery={setQuery}
          total={decks.length}
          format={format}
          playerCounts={playerCounts}
        />
      )}
    </div>
  )
}

function MetaTab({
  archetypes,
  total,
  formatName,
  format,
}: {
  archetypes: { name: string; count: number; wins: number; games: number }[]
  total: number
  formatName: string
  format: string
}) {
  return (
    <>
      {total === 0 ? (
        <p className="muted">No decks recorded for {formatName} yet.</p>
      ) : (
        <MetaList archetypes={archetypes} total={total} format={format} />
      )}
      <p className="mt-5 text-sm">
        <Link to={`/${format}/archetypes`}>Archetype classifier rules →</Link>
      </p>
    </>
  )
}

function MetaList({
  archetypes,
  total,
  format,
}: {
  archetypes: { name: string; count: number; wins: number; games: number }[]
  total: number
  format: string
}) {
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>Archetype</th>
          <th className="standings-record">Decks</th>
          <th className="standings-record">Share</th>
          <th className="standings-record">Win rate</th>
        </tr>
      </thead>
      <tbody>
        {archetypes.map(a => {
          const share = ((a.count / total) * 100).toFixed(1)
          return (
            <tr key={a.name}>
              <td>
                <Link to={`/${format}/search?q=${encodeURIComponent(a.name)}`}>{a.name}</Link>
              </td>
              <td className="standings-record">{a.count}</td>
              <td className="standings-record">{share}%</td>
              <td className="standings-record">{a.games > 0 ? `${((a.wins / a.games) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function TournamentsTab({
  tournaments,
  counts,
  format,
}: {
  tournaments: MetaTournament[]
  counts: Map<number, number>
  format: string
}) {
  if (tournaments.length === 0) return <p className="muted">No tournaments recorded yet.</p>
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>Tournament</th>
          <th>Date</th>
          <th>Location</th>
          <th className="standings-record">Decks</th>
        </tr>
      </thead>
      <tbody>
        {tournaments.map(t => {
          const count = counts.get(t.id) ?? 0
          return (
            <tr key={t.id}>
              <td>
                <Link to={`/${format}/tournaments/${t.id}`}>{t.name}</Link>
              </td>
              <td>{t.held_on ? formatDate(t.held_on) : "—"}</td>
              <td>{t.location ?? "—"}</td>
              <td className="standings-record">{count}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SearchTab({
  decks,
  query,
  onQuery,
  total,
  format,
  playerCounts,
}: {
  decks: MetaDeck[]
  query: string
  onQuery: (v: string) => void
  total: number
  format: string
  playerCounts: Map<number, number>
}) {
  return (
    <>
      <div className="mb-5 [&_.search-field]:ml-0">
        <FilterInput placeholder="Search by archetype or player…" value={query} onChange={onQuery} />
      </div>
      {total === 0 ? (
        <p className="muted">No decks recorded yet.</p>
      ) : decks.length === 0 ? (
        <p className="muted">No decks match “{query}”.</p>
      ) : (
        <table className="standings">
          <thead>
            <tr>
              <th className="standings-rank">#</th>
              <th>Deck</th>
              <th>Player</th>
              <th className="standings-record">Record</th>
              <th>Tournament</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {decks.map(d => (
              <tr key={d.id}>
                <td className="standings-rank">
                  {d.placement ?? "—"}
                  {playerCounts.has(d.tournament_id) && `/${playerCounts.get(d.tournament_id)}`}
                </td>
                <td>
                  <Link to={`/${format}/tournaments/${d.tournament_id}/decks/${d.id}`}>
                    {d.archetype ?? "Other"}
                  </Link>
                </td>
                <td>{d.player}</td>
                <td className="standings-record">{record(d) ?? "—"}</td>
                <td>
                  <Link to={`/${format}/tournaments/${d.tournament_id}`}>{d.tournament_name ?? "—"}</Link>
                </td>
                <td>{d.tournament_held_on ? formatDate(d.tournament_held_on) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
