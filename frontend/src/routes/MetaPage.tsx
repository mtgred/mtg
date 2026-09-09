import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate } from "../lib/format"
import FilterInput from "../components/FilterInput"
import { useSort } from "../lib/useSort"
import { SortTh } from "../components/SortTh"
import type { Format } from "../lib/types"

// A finishing deck within this format, carrying its tournament for context
// The `archetype` here is resolved by the classifier, or by a reported label that names a curated archetype (see supabase/schemas/archetypes.sql)
// null otherwise, shown as "Other"; comes flattened from the `meta_decks` view.
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

// Which kind of event a tournament is, for the top-level filter. Anything not ingested from MTGO is treated as a paper event
// MTGO events split into leagues (name ends "…League") and everything else competitive (Challenge, Qualifier, Showcase…), which we group as challenges
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
const CONVERSION = 0.125
const MIN_PLAYERS = 8

// Performance points for one finish: a point per doubling tier the deck clears, so
// placement/players ≤ 1/8 in an 8+ player event scores 1, ≤ 1/16 in a 16+ event 2,
// ≤ 1/32 in a 32+ event 3, and so on. Tiers nest, so this is just the deepest one reached.
function points(placement: number, players: number): number {
  let n = 0
  for (let cut = MIN_PLAYERS; players >= cut; cut *= 2) if (placement / players <= 1 / cut) n++
  return n
}

// Aggregate performance over a set of finishes. Only finishes with a placement in a
// MIN_PLAYERS+ event count as `entries` — the denominator for conversion and avg points.
type Stats = { count: number; wins: number; games: number; top: number; entries: number; points: number }
const emptyStats = (): Stats => ({ count: 0, wins: 0, games: 0, top: 0, entries: 0, points: 0 })
// Folds one finish into `e`; returns whether it was a top finish (the caller totals those).
function accumulate(e: Stats, d: MetaDeck, players: number | undefined): boolean {
  e.count++
  e.wins += d.wins ?? 0
  e.games += (d.wins ?? 0) + (d.losses ?? 0) + (d.draws ?? 0)
  if (players == null || players < MIN_PLAYERS || d.placement == null) return false
  e.entries++
  e.points += points(d.placement, players)
  if (d.placement / players >= CONVERSION) return false
  e.top++
  return true
}
const ratio = (n: number, d: number) => (d > 0 ? n / d : null)
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`)

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

  // Every recorded finish in this format, with its archetype already classified and tournament context flattened in by the `meta_decks` view
  // Powers both the archetype breakdown and the deck search. Paged in full because a busy format exceeds PostgREST's max_rows (1000)
  // and placement-less league decks sort last, so a single capped request would silently drop whole leagues.
  const decks: MetaDeck[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: dErr } = await supabase
      .from("meta_decks")
      .select("id,player,archetype,archetype_id,placement,wins,losses,draws,tournament_id,tournament_name,tournament_held_on")
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

// A ";"-separated card list as typed in the search tab, e.g. "ragavan; murktide".
const terms = (v: string) => v.split(";").map(t => t.trim()).filter(Boolean)

// Ids of the format's decks playing every named card. The card lists are millions
// of rows and a term as common as Lightning Bolt hits thousands of decks, so the
// intersection runs in Postgres and only the id set comes back — see
// meta_deck_search in supabase/schemas/tournaments.sql. Null when nothing is named.
async function loadCardMatches(format: string, main: string, side: string): Promise<Set<number> | null> {
  const [p_main, p_side] = [terms(main), terms(side)]
  if (!p_main.length && !p_side.length) return null
  const { data, error } = await supabase.rpc("meta_deck_search", { p_format: format, p_main, p_side })
  if (error) throw error
  return new Set(data as number[])
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
  // The search filter is URL-driven: ?player= matches a player name loosely, ?main=
  // and ?side= are ";"-separated card lists, and ?archetype= is the exact label a
  // Meta-tab row deep-links with (shown as a removable pill) so "Sligh" doesn't
  // also match "RG Sligh".
  const [searchParams, setSearchParams] = useSearchParams()
  const archetype = searchParams.get("archetype")
  const player = searchParams.get("player") ?? ""
  const main = searchParams.get("main") ?? ""
  const side = searchParams.get("side") ?? ""
  // Merge a partial change into the current filters, preserving any params we don't touch (e.g. the kind filter); empty/null values drop their key
  const setFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(next))
      if (v) params.set(k, v)
      else params.delete(k)
    setSearchParams(params, { replace: true })
  }
  const tab: Tab = tabParam && TAB_IDS.has(tabParam) ? (tabParam as Tab) : "meta"

  // Event-kind filter shared across all tabs, URL-driven (?kinds=) so it survives navigating to a deck/tournament and back
  // Absent param means all kinds; an empty selection is stored as "none" (a non-kind token that parses to ∅)
  const kindsParam = searchParams.get("kinds")
  // Suffix for deep-links into the search tab so they carry the current filter.
  const kindsQuery = kindsParam ? `&kinds=${kindsParam}` : ""
  const activeKinds = useMemo(
    () =>
      kindsParam == null
        ? new Set(ALL_KINDS)
        : new Set(kindsParam.split(",").filter(k => ALL_KINDS.includes(k as Kind))),
    [kindsParam]
  )
  const toggleKind = (id: Kind) => {
    const next = new Set(activeKinds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const full = ALL_KINDS.every(k => next.has(k))
    setFilters({ kinds: full ? null : ALL_KINDS.filter(k => next.has(k)).join(",") || "none" })
  }

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

  const playerCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of data?.tournaments ?? []) if (t.player_count != null) m.set(t.id, t.player_count)
    return m
  }, [data])

  const { archetypes, topTotal } = useMemo(() => {
    const map = new Map<string, Archetype>()
    let topTotal = 0
    for (const d of decks) {
      const name = d.archetype ?? "Other"
      const e = map.get(name) ?? { name, ...emptyStats() }
      if (accumulate(e, d, playerCounts.get(d.tournament_id))) topTotal++
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

  const cards = useAsync(() => loadCardMatches(format, main, side), [format, main, side])

  // Blank until something is filtered on — rendering every finish in the format is thousands of rows and janks the tab
  const matches = useMemo(() => {
    const p = player.trim().toLowerCase()
    const byCard = cards.data
    const wantsCards = terms(main).length > 0 || terms(side).length > 0
    if (!p && !archetype && !wantsCards) return NO_DECKS
    // Card query still in flight (or failed): show nothing rather than the wider
    // set the other filters alone would match.
    if (wantsCards && !byCard) return NO_DECKS
    let list = decks
    if (archetype) list = list.filter(d => (d.archetype ?? "Other") === archetype)
    if (p) list = list.filter(d => d.player.toLowerCase().includes(p))
    if (byCard) list = list.filter(d => byCard.has(d.id))
    return list
  }, [decks, player, main, side, archetype, cards.data])

  const formatName = data?.format?.name ?? format

  // A single-segment path that isn't a known format code lands here; treat it as not found rather than rendering an empty metagame
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

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {KINDS.map(k =>
          <label key={k.id} className="toggle">
            <input type="checkbox" checked={activeKinds.has(k.id)} onChange={() => toggleKind(k.id)} />
            {k.label}
          </label>)}
        <span>{decks.length} decks</span>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => {
          const count = t.id === "meta" ? archetypes.length : t.id === "tournaments" ? tournaments.length : matches.length
          return (
            <Link
              key={t.id}
              to={{ pathname: tabPath(format, t.id), search: kindsParam ? `?kinds=${kindsParam}` : "" }}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? " is-active" : ""}`}
            >
              {t.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </Link>
          )
        })}
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
      {data && tab === "tournaments" && <TournamentsTab tournaments={tournaments} counts={deckCounts} format={format} />}
      {data && tab === "search" &&
        <SearchTab
          decks={matches}
          filters={{ player, main, side }}
          onFilters={setFilters}
          archetype={archetype}
          archetypes={archetypes}
          searching={cards.loading}
          searchError={cards.error}
          total={decks.length}
          format={format}
          playerCounts={playerCounts}
          kindsQuery={kindsQuery}
        />}
    </div>
  )
}

function MetaTab({ archetypes, total, topTotal, formatName, format, kindsQuery }: {
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

type Archetype = Stats & { name: string }
const archetypeSort = {
  name: (a: Archetype) => a.name,
  count: (a: Archetype) => a.count,
  top: (a: Archetype) => a.top,
  relative: (a: Archetype) => ratio(a.top, a.entries),
  points: (a: Archetype) => ratio(a.points, a.entries),
  winrate: (a: Archetype) => ratio(a.wins, a.games),
}

function MetaList({ archetypes, total, topTotal, format, kindsQuery }: {
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
          <SortTh col="points" sort={sort} toggle={toggle} className="standings-record">
            Avg Perf
          </SortTh>
          <SortTh col="winrate" sort={sort} toggle={toggle} className="standings-record">
            Win %
          </SortTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map(a => {
          const avg = ratio(a.points, a.entries)
          return (
            <tr key={a.name}>
              <td>
                <Link to={`/${format}/search?archetype=${encodeURIComponent(a.name)}${kindsQuery}`}>{a.name}</Link>
              </td>
              <td className="standings-record">{a.count}</td>
              <td className="standings-record">{pct(ratio(a.count, total))}</td>
              <td className="standings-record">{pct(ratio(a.top, topTotal))}</td>
              <td className="standings-record">{pct(ratio(a.top, a.entries))}</td>
              <td className="standings-record">{avg == null ? "—" : avg.toFixed(2)}</td>
              <td className="standings-record">{pct(ratio(a.wins, a.games))}</td>
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

function TournamentsTab({ tournaments, counts, format }: {
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
      {rows.length === 0 ? <p className="muted">No tournaments match{query && ` “${query}”`}.</p> :
        <table className="standings">
          <thead>
            <tr>
              <SortTh col="held_on" sort={sort} toggle={toggle}>
                Date
              </SortTh>
              <SortTh col="size" sort={sort} toggle={toggle} className="standings-record">
                Players
              </SortTh>
              <SortTh col="name" sort={sort} toggle={toggle}>
                Tournament
              </SortTh>
              <SortTh col="location" sort={sort} toggle={toggle}>
                Location
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id}>
                <td>{t.held_on ? formatDate(t.held_on) : "—"}</td>
                <td className="standings-record">{t.size || "—"}</td>
                <td>
                  <Link to={`/${format}/tournaments/${t.id}`}>{t.name}</Link>
                </td>
                <td>{t.location ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>}
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

type Filters = { player: string; main: string; side: string }

// One filter box, committed on Enter or on blur: filtering thousands of finishes —
// and, for the card boxes, a round-trip to Postgres — is too costly per keystroke.
// Emptying the box commits at once so the native ✕ still clears it, and an outside
// change (a row link setting ?player=) resets the draft.
function SearchField({ label, placeholder, value, onCommit }: {
  label: string
  placeholder?: string
  value: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setDraft(value)
  }
  const commit = (v: string) => v.trim() !== value.trim() && onCommit(v.trim())
  return (
    <label className="flex w-full max-w-2xl flex-col gap-1">
      <span className="field-label">{label}</span>
      <span className="search-field block">
        <input
          className="search"
          type="search"
          placeholder={placeholder}
          value={draft}
          onChange={e => {
            setDraft(e.target.value)
            if (!e.target.value.trim()) commit("")
          }}
          onKeyDown={e => e.key === "Enter" && commit(e.currentTarget.value)}
          onBlur={e => commit(e.target.value)}
        />
      </span>
    </label>
  )
}

function SearchTab({ decks, filters, onFilters, archetype, archetypes, searching, searchError, total, format, playerCounts, kindsQuery }: {
  decks: MetaDeck[]
  filters: Filters
  onFilters: (next: Record<string, string | null>) => void
  archetype: string | null
  archetypes: Archetype[]
  searching: boolean
  searchError: string | null
  total: number
  format: string
  playerCounts: Map<number, number>
  kindsQuery: string
}) {
  const { sorted, sort, toggle } = useSort(decks, searchSort, { key: "date", dir: "desc" })
  const filtered = archetype || Object.values(filters).some(v => v.trim())
  // Alphabetical for scanning; a deep-linked archetype the current kind filter has no decks for still gets an entry so the box shows it
  const options = useMemo(() => {
    const list = [...archetypes].sort((a, b) => a.name.localeCompare(b.name))
    if (archetype && !list.some(a => a.name === archetype)) list.unshift({ name: archetype, ...emptyStats() })
    return list
  }, [archetypes, archetype])
  // Same measures as the Meta tab's table, over whatever the current filters match
  const stats = useMemo(() => {
    const s = emptyStats()
    for (const d of decks) accumulate(s, d, playerCounts.get(d.tournament_id))
    return s
  }, [decks, playerCounts])
  const avgPoints = ratio(stats.points, stats.entries)
  return (
    <>
      <div className="mb-5 flex flex-col items-start gap-3">
        <label className="flex w-full max-w-2xl flex-col gap-1">
          <span className="field-label">Archetype</span>
          <select className="input w-full" value={archetype ?? ""} onChange={e => onFilters({ archetype: e.target.value })} >
            <option value="">All archetypes</option>
            {options.map(a => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <SearchField label="Player" value={filters.player} onCommit={v => onFilters({ player: v })} />
        <SearchField label="Main deck cards — separate with ;" value={filters.main} onCommit={v => onFilters({ main: v })} />
        <SearchField label="Sideboard cards — separate with ;" value={filters.side} onCommit={v => onFilters({ side: v })} />
      </div>
      {filtered && decks.length > 0 &&
        <div className="deck-stats">
          <span>
            <span className="deck-stat-num">{pct(ratio(stats.top, stats.entries))}</span> conversion
          </span>
          <span>
            <span className="deck-stat-num">{avgPoints == null ? "—" : avgPoints.toFixed(2)}</span> avg points
          </span>
          <span>
            <span className="deck-stat-num">{pct(ratio(stats.wins, stats.games))}</span> win rate
          </span>
        </div>}
      {total === 0 ? <p className="muted">No decks recorded yet.</p> :
        !filtered ? <p className="muted">Search by player or by the cards a deck plays to list decks.</p> :
        searchError ? <p className="error">{searchError}</p> :
        searching ? <p className="muted">Searching…</p> :
        decks.length === 0 ? <p className="muted">No decks match.</p> :
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
        </table>}
    </>
  )
}
