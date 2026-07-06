import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate, formatPrice } from "../lib/format"
import type { DeckBoard, ImageUris, Prices, TournamentDeck } from "../lib/types"

// The oracle-card fields a decklist row needs to render and sort.
type ListCard = {
  id: number
  name: string
  mana_cost: string | null
  cmc: number | null
  type_line: string | null
  color_identity: string[] | null
}

type Entry = {
  id: number
  quantity: number
  board: DeckBoard
  cards: ListCard | null
}

// A sibling decklist in the same tournament, for the standings sidebar.
type Sibling = {
  id: number
  player: string
  archetype: string | null
  placement: number | null
  wins: number | null
  losses: number | null
  draws: number | null
}

type DeckData = {
  deck: TournamentDeck & {
    tournaments: {
      id: number
      name: string
      held_on: string | null
      player_count: number | null
      formats: { name: string } | null
    } | null
  }
  entries: Entry[]
  // card_id -> the first (earliest) printing: id for linking, url for the hover
  // preview, usd for first-printing pricing.
  printings: Record<number, { id: string; url?: string; usd: number | null }>
  // card_id -> the cheapest printing (id for linking, usd) for "cheapest" pricing.
  cheapest: Record<number, { id: string; usd: number | null }>
  // Every deck in this tournament, ranked, including the one shown.
  siblings: Sibling[]
}

// Boards a tournament list uses, in display order.
const BOARDS: { key: DeckBoard; label: string }[] = [
  { key: "commander", label: "Commander" },
  { key: "main", label: "Mainboard" },
  { key: "side", label: "Sideboard" },
]

// Card supertypes grouped within a board, in display order; a card is filed
// under the first type its type line contains.
const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"]

function categoryOf(typeLine: string | null | undefined): string {
  const t = typeLine ?? ""
  for (const cat of TYPE_ORDER) {
    if (cat !== "Other" && t.includes(cat)) return cat
  }
  return "Other"
}

// Basic lands (incl. snow basics) are effectively free, so pricing skips them.
function isBasicLand(typeLine: string | null | undefined): boolean {
  return (typeLine ?? "").includes("Basic")
}

// Nonfoil USD price of a printing as a number, or null when it carries no price.
function parseUsd(prices: Prices | null | undefined): number | null {
  const n = prices?.usd != null ? Number(prices.usd) : NaN
  return Number.isNaN(n) ? null : n
}

async function loadDeck(deckId: string): Promise<DeckData> {
  const { data: deck, error } = await supabase
    .from("tournament_decks")
    .select(
      "id,tournament_id,player,archetype,placement,wins,losses,draws,tournaments(id,name,held_on,player_count,formats(name))",
    )
    .eq("id", deckId)
    .maybeSingle()
  if (error) throw error
  if (!deck) throw new Error("Decklist not found.")

  const { data: entries, error: eErr } = await supabase
    .from("tournament_deck_cards")
    .select("id,quantity,board,cards(id,name,mana_cost,cmc,type_line,color_identity)")
    .eq("tournament_deck_id", deckId)
  if (eErr) throw eErr

  const rows = (entries ?? []) as unknown as Entry[]

  const { data: siblings, error: sErr } = await supabase
    .from("tournament_decks")
    .select("id,player,archetype,placement,wins,losses,draws")
    .eq("tournament_id", deck.tournament_id)
    .order("placement", { ascending: true, nullsFirst: false })
  if (sErr) throw sErr

  // Classifier-resolved archetype per deck (falls back to the reported label
  // inside the view); mirrors TournamentPage. See supabase/schemas/archetypes.sql.
  const { data: labels, error: aErr } = await supabase
    .from("meta_decks")
    .select("id,archetype")
    .eq("tournament_id", deck.tournament_id)
  if (aErr) throw aErr
  const archetypes = new Map((labels ?? []).map(l => [l.id as number, l.archetype as string | null]))

  // Oracle cards have no art, so grab one representative printing per card from
  // the card_default_printings view (one row per card, so it stays under the API
  // row cap). Keep the printing id for linking even when it carries no image.
  // card_cheapest_printings gives the lowest-USD printing per card for pricing.
  const cardIds = [...new Set(rows.map(e => e.cards?.id).filter((id): id is number => id != null))]
  const printings: DeckData["printings"] = {}
  const cheapest: DeckData["cheapest"] = {}
  if (cardIds.length > 0) {
    const [{ data: imgs, error: iErr }, { data: cheap, error: cErr }] = await Promise.all([
      supabase.from("card_default_printings").select("id,card_id,image_uris,prices").in("card_id", cardIds),
      supabase.from("card_cheapest_printings").select("id,card_id,prices").in("card_id", cardIds),
    ])
    if (iErr) throw iErr
    if (cErr) throw cErr
    for (const row of (imgs ?? []) as unknown as {
      id: string
      card_id: number
      image_uris: ImageUris | null
      prices: Prices | null
    }[]) {
      printings[row.card_id] = {
        id: row.id,
        url: row.image_uris?.normal ?? row.image_uris?.large ?? row.image_uris?.small,
        usd: parseUsd(row.prices),
      }
    }
    for (const row of (cheap ?? []) as unknown as { id: string; card_id: number; prices: Prices | null }[]) {
      cheapest[row.card_id] = { id: row.id, usd: parseUsd(row.prices) }
    }
  }

  return {
    deck: { ...(deck as unknown as DeckData["deck"]), archetype: archetypes.get(deck.id) ?? deck.archetype },
    entries: rows,
    printings,
    cheapest,
    siblings: ((siblings ?? []) as unknown as Sibling[]).map(s => ({
      ...s,
      archetype: archetypes.get(s.id) ?? s.archetype,
    })),
  }
}

type View = "list" | "visual" | "price"

const VIEWS: { key: View; label: string }[] = [
  { key: "visual", label: "Visual" },
  { key: "list", label: "List" },
  { key: "price", label: "Price" },
]

export default function TournamentDeckPage() {
  const { id = "", deckId = "", format = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadDeck(deckId), [deckId])
  const [preview, setPreview] = useState<string | null>(null)
  const [view, setView] = useState<View>("visual")

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
          <Link to={`/${format || "modern"}/tournaments/${id}`}>← Back to tournament</Link>
        </p>
      </div>
    )
  }
  if (!data) return null

  const { deck, entries, printings, cheapest, siblings } = data

  function handleEnter(cardId: number | undefined) {
    const url = cardId != null ? printings[cardId]?.url : undefined
    if (url) setPreview(url)
  }
  function handleLeave() {
    setPreview(null)
  }

  const tournamentName = deck.tournaments?.name ?? "Tournament"

  return (
    <div className="page deck-page">
      <p className="crumbs">
        <Link to={`/${format || "modern"}`}>{deck.tournaments?.formats?.name ?? "Format"}</Link>{" "}
        <span className="sep">/</span>{" "}
        <Link to={`/${format || "modern"}/tournaments`}>Tournaments</Link>{" "}
        <span className="sep">/</span>{" "}
        <Link to={`/${format || "modern"}/tournaments/${deck.tournament_id}`}>{tournamentName}</Link>
      </p>

      <header className="deck-head">
        <div className="deck-head-top">
          <h2>{deck.archetype ?? `${deck.player}'s deck`}</h2>
          <span className="deck-head-player">{deck.player}</span>
          {deck.placement != null && (
            <span className="code-badge">
              #{deck.placement}
              {deck.tournaments?.player_count != null && (
                <span className="deck-head-field"> / {deck.tournaments.player_count}</span>
              )}
            </span>
          )}
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="muted">This decklist was not recorded.</p>
      ) : (
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
                <div className="deck-main-cols">
                  {BOARDS.filter(b => b.key !== "side").map(b => {
                    const boardEntries = entries.filter(e => e.board === b.key)
                    if (boardEntries.length === 0) return null
                    return (
                      <BoardSection
                        key={b.key}
                        label={b.label}
                        entries={boardEntries}
                        printings={printings}
                        onEnter={handleEnter}
                        onLeave={handleLeave}
                      />
                    )
                  })}
                </div>
                {/* Column 3: sideboard. */}
                <div className="deck-side-col">
                  {(() => {
                    const boardEntries = entries.filter(e => e.board === "side")
                    if (boardEntries.length === 0) return null
                    return (
                      <BoardSection
                        label="Sideboard"
                        entries={boardEntries}
                        printings={printings}
                        onEnter={handleEnter}
                        onLeave={handleLeave}
                      />
                    )
                  })()}
                </div>
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
      )}

      {siblings.length > 1 && (
        <section className="deck-siblings">
          <h2 className="deck-board-head">
            {tournamentName}
            {deck.tournaments?.held_on && (
              <span className="deck-sibling-date">{formatDate(deck.tournaments.held_on)}</span>
            )}
          </h2>
          <ol className="deck-sibling-list">
            {siblings.map(s => {
              const current = s.id === deck.id
              const label = s.archetype ?? "Other"
              const record = s.wins != null || s.losses != null || s.draws != null
                ? `${s.wins ?? 0}-${s.losses ?? 0}-${s.draws ?? 0}`
                : null
              return (
                <li key={s.id} className={`deck-sibling${current ? " is-current" : ""}`}>
                  <span className="deck-sibling-rank">{s.placement ?? "—"}</span>
                  <span className="deck-sibling-record">{record}</span>
                  <span className="deck-sibling-name">
                    {current ? (
                      label
                    ) : (
                      <Link to={`/${format || "modern"}/tournaments/${deck.tournament_id}/decks/${s.id}`}>
                        {label}
                      </Link>
                    )}
                  </span>
                  <span className="deck-sibling-player">{s.player}</span>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

function BoardSection({ label, entries, printings, onEnter, onLeave }: {
  label: string
  entries: Entry[]
  printings: DeckData["printings"]
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
              <li
                className="deck-row"
                key={entry.id}
                onMouseEnter={() => onEnter(entry.cards?.id)}
                onMouseLeave={onLeave}
              >
                <span className="deck-row-name">
                  {entry.quantity}{" "}
                  {entry.cards ? (
                    <Link to={`/cards/${printings[entry.cards.id]?.id ?? ""}`}>{entry.cards.name}</Link>
                  ) : (
                    "Unknown card"
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

type PriceMode = "first" | "cheapest"

const PRICE_MODES: { key: PriceMode; label: string }[] = [
  { key: "cheapest", label: "Cheapest" },
  { key: "first", label: "First printing" },
]

function PriceView({ entries, printings, cheapest }: {
  entries: Entry[]
  printings: DeckData["printings"]
  cheapest: DeckData["cheapest"]
}) {
  const [mode, setMode] = useState<PriceMode>("cheapest")
  const source = mode === "first" ? printings : cheapest

  const boards = BOARDS.map(b => ({
    label: b.label,
    rows: entries
      .filter(e => e.board === b.key)
      .sort((a, b) => (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) || (a.cards?.name ?? "").localeCompare(b.cards?.name ?? "")),
  })).filter(b => b.rows.length > 0)

  const priceOf = (e: Entry) => !e.cards || isBasicLand(e.cards.type_line) ? null : source[e.cards.id]?.usd ?? null
  const linkFor = (e: Entry) => (e.cards ? source[e.cards.id]?.id ?? printings[e.cards.id]?.id ?? "" : "")
  const boardTotal = (rows: Entry[]) => rows.reduce((n, e) => n + (priceOf(e) ?? 0) * e.quantity, 0)
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
        <span>{mode === "first" ? "First-printing deck price" : "Cheapest deck price"}</span>
        <span className="deck-price-total-value">{formatPrice(String(deckTotal))}</span>
      </div>
      {missing && <p className="muted deck-price-note">Some cards have no market price and are counted as $0.</p>}
      {boards.map(b => (
        <section key={b.label} className="deck-price-board">
          <h2 className="deck-board-head">
            {b.label} <span className="deck-board-count">{formatPrice(String(boardTotal(b.rows)))}</span>
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
                    <td className="deck-price-unit">{formatPrice(unit != null ? String(unit) : null) ?? "—"}</td>
                    <td className="deck-price-line">{formatPrice(line != null ? String(line) : null) ?? "—"}</td>
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
  entries: Entry[]
  printings: DeckData["printings"]
}) {
  const total = entries.reduce((n, e) => n + e.quantity, 0)
  const rows = [...entries].sort((a, b) => (a.cards?.cmc ?? 0) - (b.cards?.cmc ?? 0) || (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""))

  return (
    <section className="deck-visual-board">
      <h2 className="deck-board-head">
        {label} <span className="deck-board-count">{total}</span>
      </h2>
      <ul className="deck-visual-grid">
        {rows.map(entry => {
          const printing = entry.cards ? printings[entry.cards.id] : undefined
          return (
            <li className="deck-visual-card" key={entry.id}>
              <Link to={`/cards/${printing?.id ?? ""}`} className="card-tile">
                <div className="card-img">
                  {printing ? (
                    <img src={printing.url} alt={entry.cards?.name ?? ""} loading="lazy" />
                  ) : (
                    <div className="card-img-fallback">{entry.cards?.name ?? "Unknown card"}</div>
                  )}
                </div>
              </Link>
              {entry.quantity > 1 && <span className="deck-visual-qty">{entry.quantity}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
