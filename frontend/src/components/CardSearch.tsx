import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabase"
import type { Card } from "../lib/types"
import { Symbols } from "./Symbols"

type Hit = Pick<Card, "id" | "name" | "mana_cost">

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)

// Escape ilike wildcards so a literal % or _ typed by the user is matched as-is.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

// Relevance score for ranking a name against the query. Higher is better; the
// DB pool already arrives ordered by popularity (edhrec_rank), so a stable sort
// by score keeps the popular card first among equally-good matches.
function score(name: string, query: string): number {
  const n = name.toLowerCase()
  if (n === query) return 1000
  if (n.startsWith(query)) return 900 - n.length
  const word = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)
  const idx = n.indexOf(query)
  if (word) return 700 - idx
  if (idx >= 0) return 500 - idx
  return -1
}

function rank(hits: Hit[], query: string): Hit[] {
  const q = query.toLowerCase()
  return hits
    .map(h => ({ h, s: score(h.name, q) }))
    .sort((a, b) => b.s - a.s)
    .map(({ h }) => h)
    .slice(0, 10)
}

// Splits a name into segments, marking the first case-insensitive match of the
// query so it can be emphasised in the dropdown.
function highlight(name: string, query: string) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  )
}

export default function CardSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced fuzzy lookup. Pulls a popularity-ordered pool of name matches and
  // re-ranks client-side; guards against out-of-order responses like useAsync.
  useEffect(() => {
    const q = query.trim()
    // Re-syncing search state to the current query; the rule's advice does not
    // apply to data-fetching effects that re-run on deps (see useAsync).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    let alive = true
    const timer = setTimeout(async () => {
      const pool = (pattern: string) =>
        supabase
          .from("cards")
          .select("id,name,mana_cost")
          .ilike("name", pattern)
          .order("edhrec_rank", { ascending: true, nullsFirst: false })
          .limit(25)
      // Separate exact and prefix pools so an unpopular exact match (e.g. "Scour") isn't crowded out of the substring pool by more popular cards.
      const e = escapeLike(q)
      const results = await Promise.all([pool(e), pool(`${e}%`), pool(`%${e}%`)])
      if (!alive) return
      const merged = new Map<Hit["id"], Hit>()
      for (const { data } of results) for (const h of data ?? []) merged.set(h.id, h)
      setHits(rank([...merged.values()], q))
      setActive(0)
      setLoading(false)
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  // Close the dropdown when clicking anywhere outside the search.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // Global shortcut to focus the search: Cmd/Ctrl+K, unless the user is already
  // typing in a field. ("/" is reserved for the per-page filter inputs.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)
      if (!cmdK) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) {
        return
      }
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // Routes navigate by printing id, so resolve the oldest printing of the chosen
  // oracle card before going to its page.
  async function go(hit: Hit) {
    const { data } = await supabase
      .from("printings")
      .select("id")
      .eq("card_id", hit.id)
      .order("released_at", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (!data) return
    setQuery("")
    setHits([])
    setOpen(false)
    navigate(`/cards/${data.id}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setActive(a => Math.min(a + 1, hits.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      if (hits[active]) {
        e.preventDefault()
        void go(hits[active])
      }
    } else if (e.key === "Escape") {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showMenu = open && query.trim().length >= 2

  return (
    <div className="cardsearch" ref={rootRef}>
      <input
        ref={inputRef}
        className="cardsearch-input"
        type="search"
        placeholder="Search cards…"
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showMenu}
        aria-controls="cardsearch-list"
        autoComplete="off"
      />
      <kbd className="cardsearch-hint" aria-hidden="true">
        {isMac ? "⌘" : "Ctrl"} K
      </kbd>

      {showMenu && (
        <ul className="cardsearch-menu" id="cardsearch-list" role="listbox">
          {loading && hits.length === 0 && <li className="cardsearch-empty">Searching…</li>}
          {!loading && hits.length === 0 && <li className="cardsearch-empty">No cards found.</li>}
          {hits.map((hit, i) => (
            <li key={hit.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`cardsearch-hit${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => {
                  e.preventDefault()
                  void go(hit)
                }}
              >
                <span className="cardsearch-name">{highlight(hit.name, query.trim())}</span>
                {hit.mana_cost && <Symbols text={hit.mana_cost} className="cardsearch-cost" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
