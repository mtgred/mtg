import type { ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Card, Format, Printing, Set } from "../lib/types"
import { OracleText, Symbols } from "../components/Symbols"
import { formatDate, formatPrice, listPrices, titleCase } from "../lib/format"

type SetRef = Pick<Set, "code" | "name" | "icon_svg_uri">

type FullPrinting = Printing & { cards: Card | null; sets: SetRef | null }

type Version = Pick<Printing, "id" | "collector_number" | "rarity" | "released_at" | "image_uris" | "prices" | "mtgo_id" | "mtgo_foil_id"> & { sets: SetRef | null }

type CardData = {
  printing: FullPrinting
  versions: Version[]
  formats: Format[]
  goatbots: Record<number, number> // mtgo catalog id -> Goatbots sell price (tix)
}

async function loadCard(id: string): Promise<CardData> {
  const { data: printing, error } = await supabase
    .from("printings")
    .select("*,cards(*),sets(code,name,icon_svg_uri)")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!printing) throw new Error("Card not found.")

  const full = printing as unknown as FullPrinting

  // Versions for the printings list, plus the curated format list (ordered by
  // popularity via sort_order) used to render legality badges.
  const [versionsRes, formatsRes] = await Promise.all([
    supabase
      .from("printings")
      .select("id,collector_number,rarity,released_at,image_uris,prices,mtgo_id,mtgo_foil_id,sets(code,name,icon_svg_uri)")
      .eq("card_id", full.card_id)
      .order("released_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("formats")
      .select("code,name,sort_order,description,banned_cards,restricted_cards")
      .order("sort_order", { ascending: true, nullsFirst: false }),
  ])
  if (versionsRes.error) throw versionsRes.error
  if (formatsRes.error) throw formatsRes.error
  const versions = (versionsRes.data ?? []) as unknown as Version[]

  // Goatbots MTGO sell prices for every version of the card; foil and nonfoil
  // are distinct catalog ids. Preferred over Scryfall's tix when present.
  const mtgoIds = versions.flatMap(v => [v.mtgo_id, v.mtgo_foil_id]).filter((n): n is number => n != null)
  const goatbots: Record<number, number> = {}
  if (mtgoIds.length > 0) {
    const { data: gb, error: gErr } = await supabase.from("goatbots_prices").select("mtgo_id,tix").in("mtgo_id", mtgoIds)
    if (gErr) throw gErr
    for (const row of (gb ?? []) as { mtgo_id: number; tix: number }[]) goatbots[row.mtgo_id] = Number(row.tix)
  }

  return {
    printing: full,
    versions,
    formats: (formatsRes.data ?? []) as Format[],
    goatbots,
  }
}

export default function CardPage() {
  const { id = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadCard(id), [id])

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>
  if (error) return <div className="page"><p className="error">{error}</p><p><Link to="/sets">← Back to sets</Link></p></div>
  if (!data) return null

  const { printing: p, versions, goatbots } = data
  // Goatbots sell price for an MTGO catalog id, as a display string.
  const gb = (id: number | null | undefined) => (id != null ? goatbots[id]?.toString() : undefined)
  const card = p.cards
  const set = p.sets
  const img = p.image_uris?.normal ?? p.image_uris?.large ?? p.image_uris?.small
  const stats = card?.power != null && card?.toughness != null ? `${card.power} / ${card.toughness}` : null

  return (
    <div className="page card-page">
      <p className="crumbs">
        <Link to="/sets">Sets</Link> <span className="sep">/</span>{" "}
        {set ? <Link to={`/sets/${set.code}`}>{set.name}</Link> : code(p.set_id)} <span className="sep">/</span>{" "}
        <span>{card?.name}</span>
      </p>

      <div className="card-layout">
        <div className="card-figure">
          {img ? (
            <img src={img} alt={card?.name ?? ""} />
          ) : (
            <div className="card-img-fallback large">
              <span>{card?.name}</span>
            </div>
          )}
          {p.prices && (
            <div className="price-row">
              {price("USD", formatPrice(p.prices.usd))}
              {price("Foil", formatPrice(p.prices.usd_foil))}
              {price("EUR", p.prices.eur ? `€${p.prices.eur}` : null)}
              {price("Tix", gb(p.mtgo_id) ?? p.prices.tix)}
              {price("Foil tix", gb(p.mtgo_foil_id))}
            </div>
          )}
        </div>

        <div className="card-detail">
          <div className="card-title-row">
            <h1>{card?.name}</h1>
            {card?.mana_cost ? <Symbols text={card.mana_cost} className="cost" /> : null}
          </div>

          <p className="type-line">{card?.type_line}</p>

          <OracleText text={card?.oracle_text} />

          {p.flavor_text && <p className="flavor">{p.flavor_text}</p>}

          {(stats || card?.loyalty) && (
            <p className="stats">{stats ?? `Loyalty ${card?.loyalty}`}</p>
          )}

          <dl className="facts">
            {set && (
              <Fact label="Set">
                <Link to={`/sets/${set.code}`} className="inline-set">
                  {set.icon_svg_uri && <img src={set.icon_svg_uri} alt="" />}
                  {set.name}
                </Link>
              </Fact>
            )}
            <Fact label="Rarity">
              <div className="inline-flex">
                <span className={`rarity-dot rarity-${p.rarity}`} />
                <span>{titleCase(p.rarity)}</span>
              </div>
            </Fact>
            <Fact label="Number">#{p.collector_number}</Fact>
            {p.artist && (
              <Fact label="Artist">
                <Link to={`/artists/${encodeURIComponent(p.artist)}`}>{p.artist}</Link>
              </Fact>)}
            {card?.cmc != null && <Fact label="Mana value">{card.cmc}</Fact>}
            {p.finishes?.length ? <Fact label="Finishes">{p.finishes.map(titleCase).join(", ")}</Fact> : null}
            {p.released_at && <Fact label="Released">{formatDate(p.released_at)}</Fact>}
            {card?.keywords?.length ? <Fact label="Keywords">{card.keywords.join(", ")}</Fact> : null}
            {card?.reserved && <Fact label="Reserved list">Yes</Fact>}
          </dl>

          {card && (
            <div className="legalities">
              {data.formats.map(fmt => {
                const status = legalityFor(card, fmt)
                if (!status) return null
                return (
                  <Link key={fmt.code} to={`/formats/${fmt.code}`} className={`legality legality-${status}`}>
                    {fmt.name}
                  </Link>
                )
              })}
            </div>
          )}

          {p.scryfall_uri && (
            <p>
              <a className="ext-link" href={p.scryfall_uri} target="_blank" rel="noreferrer">
                View on Scryfall ↗
              </a>
            </p>
          )}
        </div>
      </div>

      {versions.length > 1 && (
        <section className="versions">
          <h2>Printings ({versions.length})</h2>
          <ul>
            {versions.map(v => (
              <li key={v.id} className={v.id === p.id ? "current" : ""}>
                <Link to={`/cards/${v.id}`}>
                  {v.image_uris?.small ? (
                    <img className="v-thumb" src={v.image_uris.small} alt="" loading="lazy" />
                  ) : (
                    <span className="v-thumb v-thumb-fallback" />
                  )}
                  <span className={`rarity-dot rarity-${v.rarity}`} />
                  <span className="v-meta">
                    <span className="v-meta-top">
                      {v.sets?.icon_svg_uri && <img className="set-icon-sm" src={v.sets.icon_svg_uri} alt="" />}
                      <span className="v-set">{v.sets?.name ?? "Unknown set"}</span>
                      <span className="muted">#{v.collector_number}</span>
                    </span>
                    <span className="v-meta-bottom">
                      <span className="muted v-date">{formatDate(v.released_at)}</span>
                      <span className="v-prices">
                        {listPrices({ ...v.prices, tix: gb(v.mtgo_id) ?? v.prices?.tix ?? null }).map(({ label, value }) => (
                          <span key={label} className="v-price">
                            <span className="v-price-label">{label}</span>
                            {value}
                          </span>
                        ))}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// A card's legality status in a format. Curated banned/restricted overrides on
// the format win over Scryfall's `legalities`, which is unreliable for community
// formats (e.g. Old School) — keep this in sync with FormatPage's loader.
function legalityFor(card: Card, format: Format): string | undefined {
  if (format.restricted_cards?.includes(card.name)) return "restricted"
  if (format.banned_cards?.includes(card.name)) return "banned"
  return card.legalities?.[format.code]
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function price(label: string, value: string | null | undefined) {
  if (!value) return null
  return (
    <span className="price">
      <span className="price-label">{label}</span>
      <span className="price-value">{value}</span>
    </span>
  )
}

function code(setId: number) {
  return <span>Set {setId}</span>
}
