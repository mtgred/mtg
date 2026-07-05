import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { formatDate } from "../lib/format"
import type { Format, Tournament, TournamentDeck } from "../lib/types"

// A standing row: the player's finish plus a count of their recorded cards, used
// to decide whether a decklist link is worth showing.
type Standing = TournamentDeck & {
  tournament_deck_cards: { count: number }[]
}

type TournamentData = {
  tournament: Tournament
  format: Format | null
  standings: Standing[]
}

async function loadTournament(id: string): Promise<TournamentData> {
  const { data: tournament, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!tournament) throw new Error("Tournament not found.")

  const { data: standings, error: sErr } = await supabase
    .from("tournament_decks")
    .select("id,player,archetype,placement,wins,losses,draws,tournament_deck_cards(count)")
    .eq("tournament_id", id)
    .order("placement", { ascending: true, nullsFirst: false })
  if (sErr) throw sErr

  // Classifier-resolved archetype per deck (falls back to the reported label
  // inside the view); see supabase/schemas/archetypes.sql.
  const { data: labels, error: aErr } = await supabase.from("meta_decks").select("id,archetype").eq("tournament_id", id)
  if (aErr) throw aErr
  const archetypes = new Map((labels ?? []).map(l => [l.id as number, l.archetype as string | null]))

  let format: Format | null = null
  if (tournament.format) {
    const { data: f } = await supabase
      .from("formats")
      .select("code,name")
      .eq("code", tournament.format)
      .maybeSingle()
    format = (f as Format) ?? null
  }

  return {
    tournament: tournament as Tournament,
    format,
    standings: ((standings ?? []) as unknown as Standing[]).map(s => ({
      ...s,
      archetype: archetypes.get(s.id) ?? s.archetype,
    })),
  }
}

function record(d: TournamentDeck): string | null {
  if (d.wins == null && d.losses == null && d.draws == null) return null
  const parts = [d.wins ?? 0, d.losses ?? 0]
  if (d.draws) parts.push(d.draws)
  return parts.join("–")
}

export default function TournamentPage() {
  const { id = "", format: formatCode = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadTournament(id), [id])

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
          <Link to={`/${formatCode || "modern"}/tournaments`}>← Back to tournaments</Link>
        </p>
      </div>
    )
  }
  if (!data) return null

  const { tournament, format, standings } = data

  return (
    <div className="page">
      <p className="crumbs">
        <Link to={`/${formatCode || "modern"}/tournaments`}>
          {format ? `${format.name} Tournaments` : "Tournaments"}
        </Link>{" "}
        <span className="sep">/</span> <span>{tournament.name}</span>
      </p>

      <header className="set-head">
        <div>
          <h1>{tournament.name}</h1>
          <p className="set-head-meta">
            {format && (
              <Link to={`/formats/${format.code}`} className="code-badge">
                {format.name}
              </Link>
            )}
            {tournament.held_on && <span>{formatDate(tournament.held_on)}</span>}
            {tournament.location && <span>{tournament.location}</span>}
            {tournament.player_count != null && <span>{tournament.player_count} players</span>}
          </p>
        </div>
        {tournament.source_url && (
          <a className="ext-link" href={tournament.source_url} target="_blank" rel="noreferrer">
            Coverage ↗
          </a>
        )}
      </header>

      {standings.length === 0 ? (
        <p className="muted">No results recorded for this tournament yet.</p>
      ) : (
        <table className="standings">
          <thead>
            <tr>
              <th className="standings-rank">#</th>
              <th>Player</th>
              <th>Deck</th>
              <th className="standings-record">Record</th>
            </tr>
          </thead>
          <tbody>
            {standings.map(s => {
              const cardCount = s.tournament_deck_cards[0]?.count ?? 0
              const rec = record(s)
              return (
                <tr key={s.id}>
                  <td className="standings-rank">{s.placement ?? "—"}</td>
                  <td>{s.player}</td>
                  <td>
                    {cardCount > 0 ? (
                      <Link to={`/${formatCode || "modern"}/tournaments/${tournament.id}/decks/${s.id}`}>
                        {s.archetype ?? "Decklist"}
                      </Link>
                    ) : (
                      <span>{s.archetype ?? "—"}</span>
                    )}
                  </td>
                  <td className="standings-record">{rec ?? "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
