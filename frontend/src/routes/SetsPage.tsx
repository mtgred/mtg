import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Set } from "../lib/types"
import { formatDate } from "../lib/format"

async function loadSets(): Promise<Set[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("id,code,name,set_type,released_at,block,parent_set_code,card_count,digital,icon_svg_uri,scryfall_uri")
    .order("released_at", { ascending: false, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

type Tab = "main" | "commander" | "token" | "promo" | "memorabilia" | "funny" | "box"

const BOX_SET_TYPES = new Set(["box", "premium_deck", "duel_deck", "from_the_vault", "archenemy", "spellbook", "planechase"])
const OTHER_SET_TYPES = new Set(["token", "vanguard", "minigame"])

// Tabs in display order. A set is claimed by the first tab whose `match`
// returns true; anything unclaimed falls through to "main". `emptyLabel` is the
// noun used in the no-results message.
const TABS: { id: Tab; label: string; emptyLabel: string; match?: (s: Set) => boolean }[] = [
  { id: "main", label: "Sets", emptyLabel: "sets" },
  { id: "commander", label: "Commander", emptyLabel: "commander sets", match: s => s.set_type === "commander" || s.set_type === "arsenal" },
  { id: "promo", label: "Promos", emptyLabel: "promos", match: s => s.set_type === "promo" },
  { id: "memorabilia", label: "Memorabilia", emptyLabel: "memorabilia", match: s => s.set_type === "memorabilia" },
  { id: "funny", label: "Funny", emptyLabel: "funny sets", match: s => s.set_type === "funny" },
  { id: "box", label: "Box", emptyLabel: "box sets", match: s => !!s.set_type && BOX_SET_TYPES.has(s.set_type) },
  { id: "token", label: "Other", emptyLabel: "sets", match: s => !!s.set_type && OTHER_SET_TYPES.has(s.set_type) },
]

function classify(set: Set): Tab {
  for (const t of TABS) {
    if (t.match?.(set)) return t.id
  }
  return "main"
}

const TAB_IDS = new Set<string>(TABS.map(t => t.id))

export default function SetsPage() {
  const { data: sets, loading, error } = useAsync(loadSets, [])
  const [query, setQuery] = useState("")
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get("tab")
  const tab: Tab = tabParam && TAB_IDS.has(tabParam) ? (tabParam as Tab) : "main"
  const setTab = (id: Tab) =>
    setSearchParams(
      prev => {
        if (id === "main") prev.delete("tab")
        else prev.set("tab", id)
        return prev
      },
      { replace: false },
    )

  const filtered = useMemo(() => {
    if (!sets) return []
    const q = query.trim().toLowerCase()
    if (!q) return sets
    return sets.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  }, [sets, query])

  const byTab = useMemo(() => {
    const map = new Map<Tab, Set[]>(TABS.map(t => [t.id, []]))
    for (const set of filtered) map.get(classify(set))!.push(set)
    return map
  }, [filtered])

  const shown = byTab.get(tab)!
  const groups = useMemo(() => groupByYear(shown), [shown])

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          Sets <span className="page-head-count">{sets ? sets.length.toLocaleString() : ""}</span>
        </h1>
        <input
          className="search"
          type="search"
          placeholder="Filter sets by name or code…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </header>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="tab-count">{byTab.get(t.id)!.length}</span>
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading sets…</p>}
      {error && <p className="error">{error}</p>}

      {!loading &&
        groups.map(([year, sets]) => (
          <section key={year} className="set-group">
            <h2 className="set-group-title">{year}</h2>
            <SetGrid sets={sets} />
          </section>
        ))}

      {!loading && shown.length === 0 && (
        <p className="muted">
          {query
            ? `No ${TABS.find(t => t.id === tab)!.emptyLabel} match “${query}”.`
            : "Nothing here."}
        </p>
      )}
    </div>
  )
}

// Group sets into [year, sets] pairs, ordered newest first. Sets without a
// release date fall into a trailing "Unknown" group. `shown` is already sorted
// by released_at descending, so each group preserves that order.
function groupByYear(sets: Set[]): [string, Set[]][] {
  const groups = new Map<string, Set[]>()
  for (const set of sets) {
    const year = set.released_at ? set.released_at.slice(0, 4) : "Unknown"
    const group = groups.get(year)
    if (group) group.push(set)
    else groups.set(year, [set])
  }
  return [...groups.entries()]
}

function SetGrid({ sets }: { sets: Set[] }) {
  return (
    <ul className="set-grid">
      {sets.map(set => (
        <li key={set.id}>
          <Link to={`/sets/${set.code}`} className="set-card">
            <span className="set-icon">
              {set.icon_svg_uri ? <img src={set.icon_svg_uri} alt="" /> : <span className="set-icon-fallback" />}
            </span>
            <span className="set-card-body">
              <span className="set-name">{set.name}</span>
              <span className="set-meta">
                <span className="code-badge">{set.code}</span>
                {set.card_count != null && <span>{set.card_count} cards</span>}
                {set.released_at && <span>{formatDate(set.released_at)}</span>}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
