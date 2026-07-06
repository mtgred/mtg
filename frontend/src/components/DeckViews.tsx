import { useState } from "react"
import { Link } from "react-router-dom"
import { formatPrice, formatTix } from "../lib/format"
import type { DeckBoard } from "../lib/types"
import { BOARDS, TYPE_ORDER, categoryOf, isBasicLand, type Cheapest, type DeckEntry, type Printings } from "../lib/decklist"

// Callbacks that turn the list view into an editor; omit for read-only lists.
export type DeckEditing<E> = {
  onSetQuantity: (entry: E, quantity: number) => void
  onRemove: (entry: E) => void
  onMove: (entry: E, board: DeckBoard) => void
}

type View = "list" | "visual" | "price"

const VIEWS: { key: View; label: string }[] = [
  { key: "visual", label: "Visual" },
  { key: "list", label: "List" },
  { key: "price", label: "Price" },
]

// The tabbed decklist body (visual / list / price) shared by the deck builder
// and tournament decklist pages. Assumes entries is non-empty.
export function DeckViews<E extends DeckEntry>({
  entries,
  printings,
  cheapest,
  editing,
}: {
  entries: E[]
  printings: Printings
  cheapest: Cheapest
  editing?: DeckEditing<E>
}) {
  const [view, setView] = useState<View>(editing ? "list" : "visual")
  const [preview, setPreview] = useState<string | null>(null)

  function handleEnter(cardId: number | undefined) {
    const url = cardId != null ? printings[cardId]?.url : undefined
    if (url) setPreview(url)
  }
  function handleLeave() {
    setPreview(null)
  }

  const boards = (keys: DeckBoard[]) =>
    BOARDS.filter(b => keys.includes(b.key)).map(b => {
      const boardEntries = entries.filter(e => e.board === b.key)
      if (boardEntries.length === 0) return null
      return (
        <BoardSection
          key={b.key}
          label={b.label}
          entries={boardEntries}
          printings={printings}
          editing={editing}
          onEnter={handleEnter}
          onLeave={handleLeave}
        />
      )
    })

  return (
    <>
      <div className="tabs" role="tablist">
        {VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`tab${view === v.key ? " is-active" : ""}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="deck-body">
        {view === "list" ? (
          <div className="deck-list-layout">
            {/* Columns 1–2: commander + main deck, flowing across two columns. */}
            <div className="deck-main-cols">{boards(["commander", "main"])}</div>
            {/* Column 3: sideboard (and, in the builder, the maybeboard). */}
            <div className="deck-side-col">{boards(["side", "maybe"])}</div>
            {/* Column 4: hovered card preview. */}
            <div className="deck-preview-col">
              {preview && <img className="deck-preview-img" src={preview} alt="" />}
            </div>
          </div>
        ) : view === "visual" ? (
          <div className="deck-visual">
            {BOARDS.map(b => {
              const boardEntries = entries.filter(e => e.board === b.key)
              if (boardEntries.length === 0) return null
              return <VisualBoard key={b.key} label={b.label} entries={boardEntries} printings={printings} />
            })}
          </div>
        ) : (
          <PriceView entries={entries} printings={printings} cheapest={cheapest} />
        )}
      </div>
    </>
  )
}

function BoardSection<E extends DeckEntry>({
  label,
  entries,
  printings,
  editing,
  onEnter,
  onLeave,
}: {
  label: string
  entries: E[]
  printings: Printings
  editing?: DeckEditing<E>
  onEnter: (cardId: number | undefined) => void
  onLeave: () => void
}) {
  const total = entries.reduce((n, e) => n + e.quantity, 0)

  // Bucket by card supertype in TYPE_ORDER, then sort each bucket by mana value
  // and name.
  const groups = TYPE_ORDER.map(cat => ({
    cat,
    rows: entries
      .filter(e => categoryOf(e.cards?.type_line) === cat)
      // Basic lands sort to the end of their group; otherwise by mana value, name.
      .sort(
        (a, b) =>
          Number(isBasicLand(a.cards?.type_line)) - Number(isBasicLand(b.cards?.type_line)) ||
          (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) ||
          (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""),
      ),
  })).filter(g => g.rows.length > 0)

  return (
    <section className="deck-board">
      <h2 className="deck-board-head">
        {label} <span className="deck-board-count">{total}</span>
      </h2>
      {groups.map(g => (
        <div key={g.cat} className="deck-cat">
          <p className="deck-cat-head">
            {g.cat} ({g.rows.reduce((n, e) => n + e.quantity, 0)})
          </p>
          <ul className="deck-rows">
            {g.rows.map(entry => (
              <CardRow
                key={entry.id}
                entry={entry}
                printings={printings}
                editing={editing}
                onEnter={onEnter}
                onLeave={onLeave}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function CardRow<E extends DeckEntry>({
  entry,
  printings,
  editing,
  onEnter,
  onLeave,
}: {
  entry: E
  printings: Printings
  editing?: DeckEditing<E>
  onEnter: (cardId: number | undefined) => void
  onLeave: () => void
}) {
  const card = entry.cards
  const name = card ? <Link to={`/cards/${printings[card.id]?.id ?? ""}`}>{card.name}</Link> : "Unknown card"
  return (
    <li className="deck-row" onMouseEnter={() => onEnter(card?.id)} onMouseLeave={onLeave}>
      {editing ? (
        <>
          <span className="deck-stepper">
            <button
              type="button"
              className="icon-btn"
              aria-label="Decrease"
              onClick={() => editing.onSetQuantity(entry, entry.quantity - 1)}
            >
              −
            </button>
            <span className="deck-qty">{entry.quantity}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Increase"
              onClick={() => editing.onSetQuantity(entry, entry.quantity + 1)}
            >
              +
            </button>
          </span>
          <span className="deck-row-name">{name}</span>
          <span className="deck-row-actions">
            <select
              className="deck-row-board"
              aria-label="Move to board"
              value={entry.board}
              onChange={e => editing.onMove(entry, e.target.value as DeckBoard)}
            >
              {BOARDS.map(b => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => editing.onRemove(entry)}>
              ×
            </button>
          </span>
        </>
      ) : (
        <span className="deck-row-name">
          {entry.quantity} {name}
        </span>
      )}
    </li>
  )
}

type PriceMode = "first" | "cheapest" | "mtgo"

const PRICE_MODES: { key: PriceMode; label: string }[] = [
  { key: "cheapest", label: "Cheapest" },
  { key: "first", label: "First printing" },
  { key: "mtgo", label: "MTGO" },
]

const PRICE_TOTAL_LABEL: Record<PriceMode, string> = {
  cheapest: "Cheapest deck price",
  first: "First-printing deck price",
  mtgo: "MTGO deck price",
}

function PriceView({ entries, printings, cheapest }: {
  entries: DeckEntry[]
  printings: Printings
  cheapest: Cheapest
}) {
  const [mode, setMode] = useState<PriceMode>("cheapest")
  // Cheapest reads its own source; first-printing and MTGO both read the default
  // printing (usd vs. tix respectively).
  const source = mode === "cheapest" ? cheapest : printings
  const fmt = (n: number | null) => (n == null ? null : mode === "mtgo" ? formatTix(String(n)) : formatPrice(String(n)))

  const boards = BOARDS.map(b => ({
    label: b.label,
    rows: entries
      .filter(e => e.board === b.key)
      .sort((a, b) => (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) || (a.cards?.name ?? "").localeCompare(b.cards?.name ?? "")),
  })).filter(b => b.rows.length > 0)

  const priceOf = (e: DeckEntry) => {
    if (!e.cards || isBasicLand(e.cards.type_line)) return null
    if (mode === "mtgo") return printings[e.cards.id]?.tix ?? null
    return source[e.cards.id]?.usd ?? null
  }
  const linkFor = (e: DeckEntry) => (e.cards ? source[e.cards.id]?.id ?? printings[e.cards.id]?.id ?? "" : "")
  const boardTotal = (rows: DeckEntry[]) => rows.reduce((n, e) => n + (priceOf(e) ?? 0) * e.quantity, 0)
  const deckTotal = boards.reduce((n, b) => n + boardTotal(b.rows), 0)
  // Basic lands are intentionally unpriced; only flag genuinely price-less cards.
  const missing = entries.some(e => e.cards && !isBasicLand(e.cards.type_line) && priceOf(e) == null)

  return (
    <div className="deck-price">
      <div className="deck-price-modes" role="radiogroup">
        {PRICE_MODES.map(m => (
          <label key={m.key} className="deck-price-mode">
            <input
              type="radio"
              name="price-mode"
              checked={mode === m.key}
              onChange={() => setMode(m.key)}
            />
            {m.label}
          </label>
        ))}
      </div>
      <div className="deck-price-total">
        <span>{PRICE_TOTAL_LABEL[mode]}</span>
        <span className="deck-price-total-value">{fmt(deckTotal)}</span>
      </div>
      {missing && <p className="muted deck-price-note">Some cards have no market price and are counted as $0.</p>}
      {boards.map(b => (
        <section key={b.label} className="deck-price-board">
          <h2 className="deck-board-head">
            {b.label} <span className="deck-board-count">{fmt(boardTotal(b.rows))}</span>
          </h2>
          <table className="deck-price-table">
            <tbody>
              {b.rows.map(e => {
                const unit = priceOf(e)
                const line = unit != null ? unit * e.quantity : null
                return (
                  <tr key={e.id}>
                    <td className="deck-price-qty">{e.quantity}</td>
                    <td className="deck-price-name">
                      {e.cards ? <Link to={`/cards/${linkFor(e)}`}>{e.cards.name}</Link> : "Unknown card"}
                    </td>
                    <td className="deck-price-unit">{fmt(unit) ?? "—"}</td>
                    <td className="deck-price-line">{fmt(line) ?? "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

function VisualBoard({ label, entries, printings }: {
  label: string
  entries: DeckEntry[]
  printings: Printings
}) {
  const total = entries.reduce((n, e) => n + e.quantity, 0)
  const byManaThenName = (a: DeckEntry, b: DeckEntry) =>
    (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) || (a.cards?.name ?? "").localeCompare(b.cards?.name ?? "")
  const spells = entries.filter(e => categoryOf(e.cards?.type_line) !== "Land").sort(byManaThenName)
  // Nonbasic lands first, basics at the end.
  const lands = entries
    .filter(e => categoryOf(e.cards?.type_line) === "Land")
    .sort(
      (a, b) =>
        Number(isBasicLand(a.cards?.type_line)) - Number(isBasicLand(b.cards?.type_line)) || byManaThenName(a, b),
    )

  return (
    <section className="deck-visual-board">
      <h2 className="deck-board-head">
        {label} <span className="deck-board-count">{total}</span>
      </h2>
      <VisualGrid entries={spells} printings={printings} />
      {lands.length > 0 && (
        <>
          <p className="deck-cat-head">Lands ({lands.reduce((n, e) => n + e.quantity, 0)})</p>
          {/* Split high-count lands (basics) into separate stacks of four. */}
          <VisualGrid entries={lands} printings={printings} maxPerStack={4} />
        </>
      )}
    </section>
  )
}

// A grid of fanned card stacks — one card image per copy, offset downward so
// each title peeks out. Copies beyond maxPerStack spill into further stacks.
function VisualGrid({
  entries,
  printings,
  maxPerStack = Infinity,
}: {
  entries: DeckEntry[]
  printings: Printings
  maxPerStack?: number
}) {
  return (
    <ul className="deck-visual-grid">
      {entries.flatMap(entry => {
        const printing = entry.cards ? printings[entry.cards.id] : undefined
        // Split the copies into stacks of at most maxPerStack cards each.
        const stacks: number[] = []
        for (let left = entry.quantity; left > 0; left -= maxPerStack) stacks.push(Math.min(maxPerStack, left))
        return stacks.map((count, s) => (
          <li className="deck-visual-card" key={`${entry.id}-${s}`}>
            <div className="deck-visual-stack">
              {Array.from({ length: count }, (_, i) => (
                <Link key={i} to={`/cards/${printing?.id ?? ""}`} className="card-tile deck-visual-copy">
                  <div className="card-img">
                    {printing ? (
                      <img src={printing.url} alt={entry.cards?.name ?? ""} loading="lazy" />
                    ) : (
                      <div className="card-img-fallback">{entry.cards?.name ?? "Unknown card"}</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </li>
        ))
      })}
    </ul>
  )
}
