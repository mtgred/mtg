import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { useAuth } from "../lib/auth"
import type { Deck, DeckBoard, Format } from "../lib/types"
import { Symbols } from "../components/Symbols"
import CardPicker, { type PickCard } from "../components/CardPicker"

// A deck_cards entry joined with the oracle card it points at.
type Entry = {
  id: number
  quantity: number
  board: DeckBoard
  card_id: number
  printing_id: string | null
  cards: PickCard | null
}

type DeckData = {
  deck: Deck
  entries: Entry[]
  formats: Format[]
}

// Boards in the order they read down the page, with their display labels.
const BOARDS: { key: DeckBoard; label: string }[] = [
  { key: "commander", label: "Commander" },
  { key: "main", label: "Mainboard" },
  { key: "side", label: "Sideboard" },
  { key: "maybe", label: "Maybeboard" },
]

// Card supertypes grouped within a board, in display order. A card is filed
// under the first type its type line contains.
const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"]

function categoryOf(typeLine: string | null | undefined): string {
  const t = typeLine ?? ""
  for (const cat of TYPE_ORDER) {
    if (cat !== "Other" && t.includes(cat)) return cat
  }
  return "Other"
}

const WUBRG = ["W", "U", "B", "R", "G"]

async function loadDeck(id: string): Promise<DeckData> {
  const { data: deck, error } = await supabase.from("decks").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  if (!deck) throw new Error("Deck not found.")

  const { data: entries, error: eErr } = await supabase
    .from("deck_cards")
    .select("id,quantity,board,card_id,printing_id,cards(id,name,mana_cost,cmc,type_line,color_identity)")
    .eq("deck_id", id)
  if (eErr) throw eErr

  const { data: formats, error: fErr } = await supabase
    .from("formats")
    .select("code,name,sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false })
  if (fErr) throw fErr

  return {
    deck: deck as Deck,
    entries: (entries ?? []) as unknown as Entry[],
    formats: (formats ?? []) as Format[],
  }
}

export default function DeckPage() {
  const { id = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadDeck(id), [id])

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <p>
          <Link to="/decks">← Back to decks</Link>
        </p>
      </div>
    )
  }
  if (!data) return null

  // Remount on deck change so the editor's local state re-initialises cleanly.
  return <DeckEditor key={data.deck.id} data={data} />
}

function DeckEditor({ data }: { data: DeckData }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEdit = user?.id === data.deck.user_id

  const [entries, setEntries] = useState<Entry[]>(data.entries)
  const [name, setName] = useState(data.deck.name)
  const [format, setFormat] = useState(data.deck.format ?? "")
  const [description, setDescription] = useState(data.deck.description ?? "")
  const [isPublic, setIsPublic] = useState(data.deck.is_public)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function patchDeck(patch: Partial<Pick<Deck, "name" | "format" | "description" | "is_public">>) {
    const { error } = await supabase.from("decks").update(patch).eq("id", data.deck.id)
    if (error) setSaveError(error.message)
  }

  async function addCard(card: PickCard, board: DeckBoard) {
    const existing = entries.find(e => e.card_id === card.id && e.board === board)
    if (existing) return setQuantity(existing, existing.quantity + 1)
    const { data: row, error } = await supabase
      .from("deck_cards")
      .insert({ deck_id: data.deck.id, card_id: card.id, quantity: 1, board })
      .select("id,quantity,board,card_id,printing_id")
      .single()
    if (error || !row) return setSaveError(error?.message ?? "Could not add the card.")
    setEntries(es => [...es, { ...(row as Omit<Entry, "cards">), cards: card }])
  }

  async function setQuantity(entry: Entry, quantity: number) {
    if (quantity < 1) return removeCard(entry)
    const { error } = await supabase.from("deck_cards").update({ quantity }).eq("id", entry.id)
    if (error) return setSaveError(error.message)
    setEntries(es => es.map(e => (e.id === entry.id ? { ...e, quantity } : e)))
  }

  async function removeCard(entry: Entry) {
    const { error } = await supabase.from("deck_cards").delete().eq("id", entry.id)
    if (error) return setSaveError(error.message)
    setEntries(es => es.filter(e => e.id !== entry.id))
  }

  // Moving merges into any existing entry for the same card on the target board,
  // honouring the (deck, card, board) uniqueness constraint.
  async function moveCard(entry: Entry, board: DeckBoard) {
    if (entry.board === board) return
    const existing = entries.find(e => e.card_id === entry.card_id && e.board === board)
    if (existing) {
      await setQuantity(existing, existing.quantity + entry.quantity)
      await removeCard(entry)
      return
    }
    const { error } = await supabase.from("deck_cards").update({ board }).eq("id", entry.id)
    if (error) return setSaveError(error.message)
    setEntries(es => es.map(e => (e.id === entry.id ? { ...e, board } : e)))
  }

  async function deleteDeck() {
    if (!confirm("Delete this deck? This cannot be undone.")) return
    const { error } = await supabase.from("decks").delete().eq("id", data.deck.id)
    if (error) return setSaveError(error.message)
    navigate("/decks")
  }

  const colors = new Set<string>()
  for (const e of entries) {
    if (e.board === "main" || e.board === "commander") {
      for (const c of e.cards?.color_identity ?? []) colors.add(c)
    }
  }
  const pips = WUBRG.filter(c => colors.has(c))
  const mainCount = entries.filter(e => e.board === "main").reduce((n, e) => n + e.quantity, 0)
  const formatName = data.formats.find(f => f.code === format)?.name

  return (
    <div className="page deck-page">
      <p className="crumbs">
        <Link to="/decks">Decks</Link> <span className="sep">/</span> <span>{name || "Untitled deck"}</span>
      </p>

      <header className="deck-head">
        <div className="deck-head-top">
          {canEdit ? (
            <input
              className="deck-name-input"
              value={name}
              placeholder="Untitled deck"
              maxLength={255}
              onChange={e => setName(e.target.value)}
              onBlur={() => patchDeck({ name: name.trim() || "Untitled deck" })}
            />
          ) : (
            <h1>{name || "Untitled deck"}</h1>
          )}
          {canEdit && (
            <button type="button" className="btn btn-danger" onClick={deleteDeck}>
              Delete
            </button>
          )}
        </div>

        <div className="deck-meta-row">
          {canEdit ? (
            <>
              <select
                className="input"
                value={format}
                onChange={e => {
                  const next = e.target.value
                  setFormat(next)
                  patchDeck({ format: next || null })
                }}
              >
                <option value="">No format</option>
                {data.formats.map(f => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={e => {
                    setIsPublic(e.target.checked)
                    patchDeck({ is_public: e.target.checked })
                  }}
                />
                Public
              </label>
            </>
          ) : (
            <>
              {formatName && <span className="code-badge">{formatName}</span>}
              {isPublic && <span className="deck-public-tag">Public</span>}
            </>
          )}
        </div>

        {canEdit ? (
          <textarea
            className="deck-description"
            placeholder="Add a description, strategy notes, or a sideboard guide…"
            value={description}
            rows={2}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => patchDeck({ description: description.trim() || null })}
          />
        ) : (
          description && <p className="deck-description-text">{description}</p>
        )}
      </header>

      {canEdit && (
        <div className="deck-toolbar">
          <CardPicker onPick={addCard} />
        </div>
      )}

      {saveError && <p className="error">{saveError}</p>}

      <div className="deck-stats">
        <span>
          <span className="deck-stat-num">{mainCount}</span> cards in mainboard
        </span>
        {pips.length > 0 && (
          <Symbols className="deck-pips" text={pips.map(p => `{${p}}`).join("")} />
        )}
      </div>

      {entries.length === 0 ? (
        <p className="muted">
          {canEdit ? "No cards yet. Search above to add some." : "This deck has no cards yet."}
        </p>
      ) : (
        <div className="deck-columns">
          {BOARDS.map(b => {
            const boardEntries = entries.filter(e => e.board === b.key)
            if (boardEntries.length === 0) return null
            return (
              <BoardSection
                key={b.key}
                label={b.label}
                entries={boardEntries}
                canEdit={canEdit}
                onSetQuantity={setQuantity}
                onRemove={removeCard}
                onMove={moveCard}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function BoardSection({
  label,
  entries,
  canEdit,
  onSetQuantity,
  onRemove,
  onMove,
}: {
  label: string
  entries: Entry[]
  canEdit: boolean
  onSetQuantity: (entry: Entry, quantity: number) => void
  onRemove: (entry: Entry) => void
  onMove: (entry: Entry, board: DeckBoard) => void
}) {
  const total = entries.reduce((n, e) => n + e.quantity, 0)

  // Bucket by card supertype, keeping TYPE_ORDER, then sort each bucket by mana
  // value and name.
  const groups = TYPE_ORDER.map(cat => ({
    cat,
    rows: entries
      .filter(e => categoryOf(e.cards?.type_line) === cat)
      .sort((a, b) => (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) || (a.cards?.name ?? "").localeCompare(b.cards?.name ?? "")),
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
                canEdit={canEdit}
                onSetQuantity={onSetQuantity}
                onRemove={onRemove}
                onMove={onMove}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function CardRow({
  entry,
  canEdit,
  onSetQuantity,
  onRemove,
  onMove,
}: {
  entry: Entry
  canEdit: boolean
  onSetQuantity: (entry: Entry, quantity: number) => void
  onRemove: (entry: Entry) => void
  onMove: (entry: Entry, board: DeckBoard) => void
}) {
  const card = entry.cards
  return (
    <li className="deck-row">
      {canEdit ? (
        <span className="deck-stepper">
          <button type="button" className="icon-btn" aria-label="Decrease" onClick={() => onSetQuantity(entry, entry.quantity - 1)}>
            −
          </button>
          <span className="deck-qty">{entry.quantity}</span>
          <button type="button" className="icon-btn" aria-label="Increase" onClick={() => onSetQuantity(entry, entry.quantity + 1)}>
            +
          </button>
        </span>
      ) : (
        <span className="deck-qty">{entry.quantity}×</span>
      )}

      <span className="deck-row-name">{card?.name ?? "Unknown card"}</span>
      {card?.mana_cost && <Symbols text={card.mana_cost} className="deck-row-cost" />}

      {canEdit && (
        <span className="deck-row-actions">
          <select
            className="deck-row-board"
            aria-label="Move to board"
            value={entry.board}
            onChange={e => onMove(entry, e.target.value as DeckBoard)}
          >
            {BOARDS.map(b => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onRemove(entry)}>
            ×
          </button>
        </span>
      )}
    </li>
  )
}
