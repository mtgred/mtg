import { useEffect, useRef, useState } from "react"
import { supabase } from "../lib/supabase"
import type { Card, DeckBoard } from "../lib/types"
import { Symbols } from "./Symbols"

// The oracle-level fields the deck builder needs from a picked card.
export type PickCard = Pick<Card, "id" | "name" | "mana_cost" | "cmc" | "type_line" | "color_identity">

// Escape ilike wildcards so a literal % or _ typed by the user is matched as-is.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

// Relevance score for ranking a name against the query (mirrors CardSearch): the
// DB pool already arrives ordered by popularity, so a stable sort keeps the
// popular card first among equally-good matches.
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

function rank(hits: PickCard[], query: string): PickCard[] {
  const q = query.toLowerCase()
  return hits
    .map(h => ({ h, s: score(h.name, q) }))
    .sort((a, b) => b.s - a.s)
    .map(({ h }) => h)
    .slice(0, 10)
}

// Search box for the deck builder. Picking from the dropdown (Enter or click)
// just *selects* a card: the dropdown closes and its name fills the input. The
// selected card is then added with the Add / Add to sideboard buttons or, while
// it stays selected, by pressing Enter (mainboard) / Shift+Enter (sideboard)
// repeatedly to add multiple copies without retyping.
export default function CardPicker({ onPick }: { onPick: (card: PickCard, board: DeckBoard) => void }) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<PickCard[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<PickCard | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced popularity-ordered lookup, re-ranked client-side; guards against
  // out-of-order responses like useAsync.
  useEffect(() => {
    const q = query.trim()
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
      const { data, error } = await supabase
        .from("cards")
        .select("id,name,mana_cost,cmc,type_line,color_identity")
        .ilike("name", `%${escapeLike(q)}%`)
        .order("edhrec_rank", { ascending: true, nullsFirst: false })
        .limit(25)
      if (!alive) return
      setHits(error ? [] : rank((data ?? []) as PickCard[], q))
      setActive(0)
      setLoading(false)
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  // Close the dropdown when clicking anywhere outside the picker.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // Choose a card from the dropdown: close the menu, fill the input with its
  // name, and remember it as the selection to add.
  function select(card: PickCard) {
    setSelected(card)
    setQuery(card.name)
    setOpen(false)
    inputRef.current?.focus()
  }

  // Add the selected card, keeping the selection so more copies can be added.
  function add(board: DeckBoard) {
    if (!selected) return
    onPick(selected, board)
    inputRef.current?.focus()
  }

  const showMenu = open && query.trim().length >= 2

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setActive(a => Math.min(a + 1, hits.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      if (showMenu && hits[active]) {
        e.preventDefault()
        select(hits[active])
      } else if (selected) {
        e.preventDefault()
        add(e.shiftKey ? "side" : "main")
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="cardpicker" ref={rootRef}>
      <div className="cardpicker-row">
        <input
          ref={inputRef}
          className="search"
          type="search"
          placeholder="Add a card…"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelected(null)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls="cardpicker-list"
          autoComplete="off"
        />
        <button type="button" className="btn" disabled={!selected} onClick={() => add("main")}>
          Add <kbd className="btn-kbd">⏎</kbd>
        </button>
        <button type="button" className="btn btn-soft" disabled={!selected} onClick={() => add("side")}>
          Add to sideboard <kbd className="btn-kbd">⇧⏎</kbd>
        </button>
      </div>

      {showMenu && (
        <ul className="cardsearch-menu" id="cardpicker-list" role="listbox">
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
                  setActive(i)
                  select(hit)
                }}
              >
                <span className="cardsearch-name">{hit.name}</span>
                {hit.mana_cost && <Symbols text={hit.mana_cost} className="cardsearch-cost" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
