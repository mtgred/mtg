import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate } from "../lib/format"
import type { TournamentDeck } from "../lib/types"
import { DeckViews } from "../components/DeckViews"
import { loadPrintings, type Cheapest, type DeckEntry, type Printings } from "../lib/decklist"

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
  entries: DeckEntry[]
  printings: Printings
  cheapest: Cheapest
  // Every deck in this tournament, ranked, including the one shown.
  siblings: Sibling[]
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

  const rows = (entries ?? []) as unknown as DeckEntry[]

  const { data: siblings, error: sErr } = await supabase
    .from("tournament_decks")
    .select("id,player,archetype,placement,wins,losses,draws")
    .eq("tournament_id", deck.tournament_id)
    .order("placement", { ascending: true, nullsFirst: false })
  if (sErr) throw sErr

  // Resolved archetype per deck — the view keeps a reported label only when it
  // names a curated archetype; mirrors TournamentPage. See supabase/schemas/archetypes.sql.
  const { data: labels, error: aErr } = await supabase
    .from("meta_decks")
    .select("id,archetype")
    .eq("tournament_id", deck.tournament_id)
  if (aErr) throw aErr
  const archetypes = new Map((labels ?? []).map(l => [l.id as number, l.archetype as string | null]))

  const cardIds = [...new Set(rows.map(e => e.cards?.id).filter((id): id is number => id != null))]
  const { printings, cheapest } = await loadPrintings(cardIds)

  return {
    deck: { ...(deck as unknown as DeckData["deck"]), archetype: archetypes.get(deck.id) ?? null },
    entries: rows,
    printings,
    cheapest,
    siblings: ((siblings ?? []) as unknown as Sibling[]).map(s => ({
      ...s,
      archetype: archetypes.get(s.id) ?? null,
    })),
  }
}

export default function TournamentDeckPage() {
  const { id = "", deckId = "", format = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadDeck(deckId), [deckId])

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
          <Link to={`/${format || "modern"}/search?q=${encodeURIComponent(deck.player)}`}>
            {deck.player}
          </Link>
          {deck.placement != null && (
            <span className="code-badge">
              Rank {deck.placement}
              {deck.tournaments?.player_count != null && (<span>/{deck.tournaments.player_count}</span>)}
            </span>)}
          {(deck.wins != null || deck.losses != null || deck.draws != null) && (
            <span className="deck-head-record">
              {deck.wins ?? 0}-{deck.losses ?? 0}-{deck.draws ?? 0}
            </span>)}
          {deck.tournaments?.held_on && <span>{formatDate(deck.tournaments.held_on)}</span>}
        </div>
      </header>

      {entries.length === 0 ? <p className="muted">This decklist was not recorded.</p> :
        <DeckViews entries={entries} printings={printings} cheapest={cheapest} />}

      {siblings.length > 1 && (
        <section className="deck-siblings">
          <h2 className="deck-board-head">
            {tournamentName}
            {deck.tournaments?.held_on && <span className="deck-sibling-date">{formatDate(deck.tournaments.held_on)}</span>}
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
                    {current ? label :
                      <Link to={`/${format || "modern"}/tournaments/${deck.tournament_id}/decks/${s.id}`}>
                        {label}
                      </Link>}
                  </span>
                  <span className="deck-sibling-player">
                    <Link to={`/${format || "modern"}/search?q=${encodeURIComponent(s.player)}`}>{s.player}</Link>
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
