import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate } from "../lib/format"
import FilterInput from "../components/FilterInput"
import { useSort } from "../lib/useSort"
import { SortTh } from "../components/SortTh"
import type { Format } from "../lib/types"

// A finishing deck within this format, carrying its tournament for context. The
// `archetype` here is resolved by the classifier, or by a reported label that names
// a curated archetype (see supabase/schemas/archetypes.sql) — null otherwise, shown
// as "Other"; comes flattened from the `meta_decks` view.
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
  source: string | null
}

// Which kind of event a tournament is, for the top-level filter. Anything not
// ingested from MTGO is treated as a paper event; MTGO events split
// into leagues (name ends "…League") and everything else competitive (Challenge,
// Qualifier, Showcase…), which we group as challenges.
type Kind = "paper" | "challenge" | "league"
function tournamentKind(t: { source: string | null; name: string }): Kind {
  if (t.source !== "mtgo") return "paper"
  return /league\b/i.test(t.name) ? "league" : "challenge"
}
const KINDS: { id: Kind; label: string }[] = [
  { id: "paper", label: "Paper tournaments" },
  { id: "challenge", label: "MTGO challenges" },
  { id: "league", label: "MTGO leagues" },
]
const ALL_KINDS = KINDS.map(k => k.id)

// How deep a "top finish" runs for a given field size — the winner alone for 8–15
// players, doubling every doubling of the field, capped at top 32. Events under 8
// players (and those with no reported size) don't qualify at all, and score 0.
const TOP_CUTS: [number, number][] = [
  [256, 32],
  [128, 16],
  [64, 8],
  [32, 4],
  [16, 2],
  [8, 1],
]
const topCut = (players: number | undefined) =>
  players == null ? 0 : (TOP_CUTS.find(([min]) => players >= min)?.[1] ?? 0)

type MetaData = {
  format: Format | null
  tournaments: MetaTournament[]
  decks: MetaDeck[]
}

async function loadMeta(format: string): Promise<MetaData> {
  const { data: fmt } = await supabase.from("formats").select("code,name").eq("code", format).maybeSingle()

  const { data: tournaments, error: tErr } = await supabase
    .from("tournaments")
    .select("id,name,held_on,location,player_count,source")
    .eq("format", format)
    .order("held_on", { ascending: false, nullsFirst: false })
  if (tErr) throw tErr

  // Every recorded finish in this format, with its archetype already classified
  // and tournament context flattened in by the `meta_decks` view. Powers both
  // the archetype breakdown and the deck search. Paged in full because a busy
  // format exceeds PostgREST's max_rows (1000) — and placement-less league decks
  // sort last, so a single capped request would silently drop whole leagues.
  const decks: MetaDeck[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: dErr } = await supabase
      .from("meta_decks")
      .select(
        "id,player,archetype,archetype_id,placement,wins,losses,draws,tournament_id,tournament_name,tournament_held_on"
      )
      .eq("format", format)
      .order("placement", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (dErr) throw dErr
    decks.push(...((page ?? []) as unknown as MetaDeck[]))
    if (!page || page.length < PAGE) break
  }

  return {
    format: (fmt as Format) ?? null,
    tournaments: (tournaments ?? []) as MetaTournament[],
    decks,
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
  // The search filter is URL-driven: ?q= for free-text, ?archetype= / ?player= for
  // exact matches — archetype and player rows deep-link with the latter two (shown
  // as removable pills) so "Sligh" doesn't also match "RG Sligh".
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get("q") ?? ""
  const archetype = searchParams.get("archetype")
  const player = searchParams.get("player")
  // Merge a partial change into the current filters, preserving any params we
  // don't touch (e.g. the kind filter); empty/null values drop their key.
  const setFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v)
      else params.delete(k)
    setSearchParams(params, { replace: true })
  }
  const setQuery = (v: string) => setFilters({ q: v })

  const tab: Tab = tabParam && TAB_IDS.has(tabParam) ? (tabParam as Tab) : "meta"

  // Event-kind filter shared across all tabs, URL-driven (?kinds=) so it survives
  // navigating to a deck/tournament and back. Absent param means all kinds; an
  // empty selection is stored as "none" (a non-kind token that parses to ∅).
  const kindsParam = searchParams.get("kinds")
  // Suffix for deep-links into the search tab so they carry the current filter.
  const kindsQuery = kindsParam ? `&kinds=${kindsParam}` : ""
  const activeKinds = useMemo(
    () => (kindsParam == null ? new Set(ALL_KINDS) : new Set(kindsParam.split(",").filter(k => ALL_KINDS.includes(k as Kind)))),
    [kindsParam]
  )
  const toggleKind = (id: Kind) => {
    const next = new Set(activeKinds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const full = ALL_KINDS.every(k => next.has(k))
    setFilters({ kinds: full ? null : ALL_KINDS.filter(k => next.has(k)).join(",") || "none" })
  }

  // tournament_id -> kind, so decks (which only carry a tournament id) can be
  // filtered by the same toggles as the tournament rows.
  const kindById = useMemo(() => {
    const m = new Map<number, Kind>()
    for (const t of data?.tournaments ?? []) m.set(t.id, tournamentKind(t))
    return m
  }, [data])

  const tournaments = useMemo(
    () => (data?.tournaments ?? []).filter(t => activeKinds.has(tournamentKind(t))),
    [data, activeKinds]
  )
  const decks = useMemo(
    () => (data?.decks ?? NO_DECKS).filter(d => activeKinds.has(kindById.get(d.tournament_id) ?? "paper")),
    [data, kindById, activeKinds]
  )

  // tournament_id -> player_count, for showing "placement/players" in search and
  // for sizing each event's top cut.
  const playerCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of data?.tournaments ?? []) if (t.player_count != null) m.set(t.id, t.player_count)
    return m
  }, [data])

  // Archetype share across every finish, plus its share of the top finishes
  // (`top` / `topTotal`) — a size-weighted signal that ignores the long tail of
  // small events and mid-field decks. `entries` counts only the finishes in events
  // that have a top cut at all, so `top` / `entries` is a fair conversion rate.
  const { archetypes, topTotal } = useMemo(() => {
    const map = new Map<string, Archetype>()
    let topTotal = 0
    for (const d of decks) {
      const name = d.archetype ?? "Other"
      const e = map.get(name) ?? { name, count: 0, wins: 0, games: 0, top: 0, entries: 0 }
      e.count++
      e.wins += d.wins ?? 0
      e.games += (d.wins ?? 0) + (d.losses ?? 0) + (d.draws ?? 0)
      const cut = topCut(playerCounts.get(d.tournament_id))
      if (cut > 0) e.entries++
      if (d.placement != null && d.placement <= cut) {
        e.top++
        topTotal++
      }
      map.set(name, e)
    }
    const archetypes = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { archetypes, topTotal }
  }, [decks, playerCounts])

  const deckCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const d of decks) m.set(d.tournament_id, (m.get(d.tournament_id) ?? 0) + 1)
    return m
  }, [decks])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = decks
    if (archetype) list = list.filter(d => (d.archetype ?? "Other") === archetype)
    if (player) list = list.filter(d => d.player === player)
    if (q)
      list = list.filter(d => (d.archetype ?? "Other").toLowerCase().includes(q) || d.player.toLowerCase().includes(q))
    return list
  }, [decks, query, archetype, player])

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
        <h1>{formatName}</h1>
      </header>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {KINDS.map(k => (
          <label key={k.id} className="toggle text-sm">
            <input type="checkbox" checked={activeKinds.has(k.id)} onChange={() => toggleKind(k.id)} />
            {k.label}
          </label>
        ))}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <Link
            key={t.id}
            to={{ pathname: tabPath(format, t.id), search: kindsParam ? `?kinds=${kindsParam}` : "" }}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " is-active" : ""}`}
          >
            {t.label}
            <span className="tab-count">
              {t.id === "meta"
                ? archetypes.length
                : t.id === "tournaments"
                  ? tournaments.length
                  : decks.length}
            </span>
          </Link>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data && tab === "meta" && (
        <MetaTab
          archetypes={archetypes}
          total={decks.length}
          topTotal={topTotal}
          formatName={formatName}
          format={format}
          kindsQuery={kindsQuery}
        />
      )}
      {data && tab === "tournaments" && (
        <TournamentsTab tournaments={tournaments} counts={deckCounts} format={format} />
      )}
      {data && tab === "search" && (
        <SearchTab
          decks={matches}
          query={query}
          onQuery={setQuery}
          archetype={archetype}
          onClearArchetype={() => setFilters({ archetype: null })}
          player={player}
          onClearPlayer={() => setFilters({ player: null })}
          total={decks.length}
          format={format}
          playerCounts={playerCounts}
          kindsQuery={kindsQuery}
        />
      )}
    </div>
  )
}

function MetaTab({
  archetypes,
  total,
  topTotal,
  formatName,
  format,
  kindsQuery,
}: {
  archetypes: Archetype[]
  total: number
  topTotal: number
  formatName: string
  format: string
  kindsQuery: string
}) {
  return (
    <>
      {total === 0 ? (
        <p className="muted">No decks recorded for {formatName} yet.</p>
      ) : (
        <MetaList archetypes={archetypes} total={total} topTotal={topTotal} format={format} kindsQuery={kindsQuery} />
      )}
      <p className="mt-5 text-sm">
        <Link to={`/${format}/archetypes`}>Archetype classifier rules →</Link>
      </p>
    </>
  )
}

type Archetype = { name: string; count: number; wins: number; games: number; top: number; entries: number }
const archetypeSort = {
  name: (a: Archetype) => a.name,
  count: (a: Archetype) => a.count,
  top: (a: Archetype) => a.top,
  relative: (a: Archetype) => (a.entries > 0 ? a.top / a.entries : null),
  winrate: (a: Archetype) => (a.games > 0 ? a.wins / a.games : null),
}

function MetaList({
  archetypes,
  total,
  topTotal,
  format,
  kindsQuery,
}: {
  archetypes: Archetype[]
  total: number
  topTotal: number
  format: string
  kindsQuery: string
}) {
  const { sorted, sort, toggle } = useSort(archetypes, archetypeSort, { key: "count", dir: "desc" })
  return (
    <table className="standings">
      <thead>
        <tr>
          <SortTh col="name" sort={sort} toggle={toggle}>
            Archetype
          </SortTh>
          <SortTh col="count" sort={sort} toggle={toggle} className="standings-record">
            Decks
          </SortTh>
          <SortTh col="count" sort={sort} toggle={toggle} className="standings-record">
            Meta %
          </SortTh>
          <SortTh col="top" sort={sort} toggle={toggle} className="standings-record">
            Top %
          </SortTh>
          <SortTh col="relative" sort={sort} toggle={toggle} className="standings-record">
            Conversion %
          </SortTh>
          <SortTh col="winrate" sort={sort} toggle={toggle} className="standings-record">
            Win %
          </SortTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map(a => {
          const share = a.count / total
          const topShare = topTotal > 0 ? a.top / topTotal : null
          // How often the archetype converts: the share of its finishes in cut-eligible
          // events that landed in the top cut.
          const relative = a.entries > 0 ? a.top / a.entries : null
          return (
            <tr key={a.name}>
              <td>
                <Link to={`/${format}/search?archetype=${encodeURIComponent(a.name)}${kindsQuery}`}>{a.name}</Link>
              </td>
              <td className="standings-record">{a.count}</td>
              <td className="standings-record">{(share * 100).toFixed(1)}%</td>
              <td className="standings-record">{topShare == null ? "—" : `${(topShare * 100).toFixed(1)}%`}</td>
              <td className="standings-record">
                {relative == null ? "—" : `${(relative * 100).toFixed(1)}%`}
              </td>
              <td className="standings-record">{a.games > 0 ? `${((a.wins / a.games) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

type TournamentRow = MetaTournament & { count: number; size: number }
const tournamentSort = {
  name: (t: TournamentRow) => t.name,
  held_on: (t: TournamentRow) => t.held_on,
  location: (t: TournamentRow) => t.location,
  size: (t: TournamentRow) => t.size,
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
  // MTGO challenges only publish the top 32 decklists, so a raw deck count is
  // always 32 and uninformative — prefer the reported field size, falling back
  // to the recorded deck count for events without one (e.g. leagues).
  const [query, setQuery] = useState("")
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tournaments
      .map(t => {
        const count = counts.get(t.id) ?? 0
        return { ...t, count, size: t.player_count ?? count }
      })
      .filter(t => !q || t.name.toLowerCase().includes(q) || (t.location ?? "").toLowerCase().includes(q))
  }, [tournaments, counts, query])
  const { sorted, sort, toggle } = useSort(rows, tournamentSort, { key: "held_on", dir: "desc" })
  if (tournaments.length === 0) return <p className="muted">No tournaments recorded yet.</p>
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 [&_.search-field]:ml-0 [&_.search-field]:w-96">
        <FilterInput placeholder="Search by tournament or location…" value={query} onChange={setQuery} />
      </div>
      {rows.length === 0 ? (
        <p className="muted">No tournaments match{query && ` “${query}”`}.</p>
      ) : (
        <table className="standings">
          <thead>
            <tr>
              <SortTh col="name" sort={sort} toggle={toggle}>
                Tournament
              </SortTh>
              <SortTh col="held_on" sort={sort} toggle={toggle}>
                Date
              </SortTh>
              <SortTh col="location" sort={sort} toggle={toggle}>
                Location
              </SortTh>
              <SortTh col="size" sort={sort} toggle={toggle} className="standings-record">
                Players
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id}>
                <td>
                  <Link to={`/${format}/tournaments/${t.id}`}>{t.name}</Link>
                </td>
                <td>{t.held_on ? formatDate(t.held_on) : "—"}</td>
                <td>{t.location ?? "—"}</td>
                <td className="standings-record">{t.size || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

const searchSort = {
  placement: (d: MetaDeck) => d.placement,
  archetype: (d: MetaDeck) => d.archetype ?? "Other",
  player: (d: MetaDeck) => d.player,
  wins: (d: MetaDeck) => d.wins,
  tournament: (d: MetaDeck) => d.tournament_name,
  date: (d: MetaDeck) => d.tournament_held_on,
}

function FilterPill({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="filter-pill">
      <span className="filter-pill-label">{label}</span>
      {value}
      <button type="button" aria-label={`Clear ${label.toLowerCase()} filter`} onClick={onClear}>
        ×
      </button>
    </span>
  )
}

function SearchTab({
  decks,
  query,
  onQuery,
  archetype,
  onClearArchetype,
  player,
  onClearPlayer,
  total,
  format,
  playerCounts,
  kindsQuery,
}: {
  decks: MetaDeck[]
  query: string
  onQuery: (v: string) => void
  archetype: string | null
  onClearArchetype: () => void
  player: string | null
  onClearPlayer: () => void
  total: number
  format: string
  playerCounts: Map<number, number>
  kindsQuery: string
}) {
  const { sorted, sort, toggle } = useSort(decks, searchSort, { key: "date", dir: "desc" })
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 [&_.search-field]:ml-0 [&_.search-field]:w-96">
        <FilterInput placeholder="Search by archetype or player…" value={query} onChange={onQuery} />
        {archetype && <FilterPill label="Archetype" value={archetype} onClear={onClearArchetype} />}
        {player && <FilterPill label="Player" value={player} onClear={onClearPlayer} />}
      </div>
      {total === 0 ? (
        <p className="muted">No decks recorded yet.</p>
      ) : decks.length === 0 ? (
        <p className="muted">No decks match{query && ` “${query}”`}.</p>
      ) : (
        <table className="standings">
          <thead>
            <tr>
              <SortTh col="date" sort={sort} toggle={toggle} className="standings-record">
                Date
              </SortTh>
              <SortTh col="placement" sort={sort} toggle={toggle} className="standings-rank standings-record">
                Rank
              </SortTh>
              <SortTh col="wins" sort={sort} toggle={toggle} className="standings-record">
                Record
              </SortTh>
              <SortTh col="archetype" sort={sort} toggle={toggle}>
                Deck
              </SortTh>
              <SortTh col="player" sort={sort} toggle={toggle}>
                Player
              </SortTh>
              <SortTh col="tournament" sort={sort} toggle={toggle}>
                Tournament
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(d => (
              <tr key={d.id}>
                <td className="standings-record">{d.tournament_held_on ? formatDate(d.tournament_held_on) : "—"}</td>
                <td className="standings-rank standings-record">
                  {d.placement ?? "—"}
                  {playerCounts.has(d.tournament_id) && `/${playerCounts.get(d.tournament_id)}`}
                </td>
                <td className="standings-record">{record(d) ?? "—"}</td>
                <td>
                  <Link to={`/${format}/tournaments/${d.tournament_id}/decks/${d.id}`}>{d.archetype ?? "Other"}</Link>
                </td>
                <td>
                  <Link to={`/${format}/search?player=${encodeURIComponent(d.player)}${kindsQuery}`}>{d.player}</Link>
                </td>
                <td>
                  <Link to={`/${format}/tournaments/${d.tournament_id}`}>{d.tournament_name ?? "—"}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
