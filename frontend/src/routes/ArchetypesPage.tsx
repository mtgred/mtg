import { useState } from "react"
import { BsArrowLeft } from "react-icons/bs"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { useAuth } from "../lib/auth"
import type { Archetype, Format } from "../lib/types"

// An archetype rule as edited on this page. Numeric fields and the signature
// list stay raw strings while typing and are parsed on save. `id` is null for
// rows not yet inserted; `key` is the stable local identity (negative for new).
type Rule = {
  key: number
  id: number | null
  name: string
  sortOrder: string
  minSignatures: string
  signatures: string
  required: string
  exclusions: string
  dirty: boolean
  saving: boolean
  error: string | null
  warning: string | null
}

// How many decks the classifier currently assigns to each rule, per meta_decks.
type Stats = { byId: Record<number, number>; matched: number; total: number }

type PageData = { format: Format | null; rules: Rule[]; stats: Stats }

function toRule(a: Archetype): Rule {
  return {
    key: a.id,
    id: a.id,
    name: a.name,
    sortOrder: a.sort_order?.toString() ?? "",
    minSignatures: a.min_signatures?.toString() ?? "",
    signatures: a.signature_cards.join("\n"),
    required: (a.required_cards ?? []).join("\n"),
    exclusions: (a.excluded_cards ?? []).join("\n"),
    dirty: false,
    saving: false,
    error: null,
    warning: null,
  }
}

async function loadStats(format: string): Promise<Stats> {
  const { data, error } = await supabase.from("meta_decks").select("archetype_id").eq("format", format)
  if (error) throw error
  const stats: Stats = { byId: {}, matched: 0, total: (data ?? []).length }
  for (const { archetype_id } of (data ?? []) as { archetype_id: number | null }[]) {
    if (archetype_id == null) continue
    stats.byId[archetype_id] = (stats.byId[archetype_id] ?? 0) + 1
    stats.matched++
  }
  return stats
}

async function loadPage(format: string): Promise<PageData> {
  const { data: fmt } = await supabase.from("formats").select("code,name").eq("code", format).maybeSingle()
  const { data: archetypes, error } = await supabase
    .from("archetypes")
    .select("id,format,name,sort_order,signature_cards,min_signatures,required_cards,excluded_cards")
    .eq("format", format)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name")
  if (error) throw error
  return {
    format: (fmt as Format) ?? null,
    rules: ((archetypes ?? []) as Archetype[]).map(toRule),
    stats: await loadStats(format),
  }
}

const lines = (text: string) =>
  text
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)

let newRuleKey = 0

export default function ArchetypesPage() {
  const { format = "" } = useParams()
  const { data, loading, error } = useAsync(() => loadPage(format), [format])

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (error || !data || !data.format) {
    return (
      <div className="page">
        <p className="error">{error ?? `Unknown format “${format}”.`}</p>
        <p>
          <Link to="/formats"><BsArrowLeft className="inline" /> Browse formats</Link>
        </p>
      </div>
    )
  }
  // Remount on format change so the editor's local state re-initialises cleanly.
  return <RulesEditor key={format} format={format} formatName={data.format.name} data={data} />
}

function RulesEditor({ format, formatName, data }: { format: string; formatName: string; data: PageData }) {
  const { user } = useAuth()
  const canEdit = !!user
  const [rules, setRules] = useState(data.rules)
  const [stats, setStats] = useState(data.stats)

  const patch = (key: number, p: Partial<Rule>) => setRules(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)))
  const edit = (key: number, p: Partial<Rule>) => patch(key, { ...p, dirty: true })
  // Any rule change can reclassify every deck in the format, so recount after saves.
  const refreshStats = () => loadStats(format).then(setStats, () => {})

  async function saveRule(rule: Rule) {
    const name = rule.name.trim()
    const signature_cards = lines(rule.signatures)
    const required_cards = lines(rule.required)
    const excluded_cards = lines(rule.exclusions)
    if (!name || signature_cards.length + required_cards.length === 0) {
      return patch(rule.key, { error: "A name and at least one signature or must-include card are required." })
    }
    patch(rule.key, { saving: true, error: null, warning: null })
    const row = {
      format,
      name,
      sort_order: rule.sortOrder.trim() ? Number(rule.sortOrder) : null,
      min_signatures: rule.minSignatures.trim() ? Number(rule.minSignatures) : null,
      signature_cards,
      required_cards,
      excluded_cards,
    }
    const query =
      rule.id == null
        ? supabase.from("archetypes").insert(row).select("id").single()
        : supabase.from("archetypes").update(row).eq("id", rule.id).select("id").single()
    const { data: saved, error } = await query
    if (error || !saved) return patch(rule.key, { saving: false, error: error?.message ?? "Could not save." })

    // Card names match cards.name exactly, so a typo silently never matches —
    // surface names the card database doesn't know.
    const listed = [...signature_cards, ...required_cards, ...excluded_cards]
    const { data: known } = await supabase.from("cards").select("name").in("name", listed)
    const knownNames = new Set((known ?? []).map(c => c.name))
    const missing = listed.filter(n => !knownNames.has(n))
    patch(rule.key, {
      id: saved.id,
      saving: false,
      dirty: false,
      warning: missing.length ? `Not found in the card database: ${missing.join(", ")}` : null,
    })
    refreshStats()
  }

  async function deleteRule(rule: Rule) {
    if (rule.id != null) {
      if (!confirm(`Delete the “${rule.name || "unnamed"}” rule?`)) return
      const { error } = await supabase.from("archetypes").delete().eq("id", rule.id)
      if (error) return patch(rule.key, { error: error.message })
    }
    setRules(rs => rs.filter(r => r.key !== rule.key))
    if (rule.id != null) refreshStats()
  }

  function addRule() {
    setRules(rs => [
      ...rs,
      {
        key: --newRuleKey,
        id: null,
        name: "",
        sortOrder: "",
        minSignatures: "",
        signatures: "",
        required: "",
        exclusions: "",
        dirty: true,
        saving: false,
        error: null,
        warning: null,
      },
    ])
  }

  return (
    <div className="page">
      <p className="crumbs">
        <Link to={`/${format}`}>{formatName}</Link> <span className="sep">/</span> <span>Archetype rules</span>
      </p>

      <header className="page-head">
        <h1>
          {formatName} Archetype Rules <span className="page-head-count">{rules.length || ""}</span>
        </h1>
      </header>

      <p className="muted max-w-180 mb-2">
        A finishing deck is labeled with an archetype when its mainboard and commander contain at least “min matches” of
        the rule’s “must include” and signature cards combined (blank = all of them), play every “must include” card,
        and none of the excluded ones. When several rules match, the one matching the most cards wins, then the one
        naming the most cards, then sort order.
      </p>
      <p className="muted mb-6">
        {stats.matched.toLocaleString()} of {stats.total.toLocaleString()} recorded decks currently match a rule.
        {!canEdit && (
          <>
            {" "}
            <Link to="/signin">Sign in</Link> to edit the rules.
          </>
        )}
      </p>

      {rules.length === 0 && <p className="muted">No rules defined for {formatName} yet.</p>}

      <ul className="list-none m-0 p-0 flex flex-col gap-4 max-w-180">
        {rules.map(rule => (
          <li
            key={rule.key}
            className="flex flex-col gap-3 p-4 bg-paper-raised border border-border rounded-card shadow-sm"
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5 flex-1 min-w-40">
                <span className="field-label">Name</span>
                <input
                  className="input cursor-text"
                  value={rule.name}
                  maxLength={255}
                  disabled={!canEdit}
                  onChange={e => edit(rule.key, { name: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5 w-20">
                <span className="field-label">Sort</span>
                <input
                  className="input cursor-text"
                  type="number"
                  value={rule.sortOrder}
                  disabled={!canEdit}
                  onChange={e => edit(rule.key, { sortOrder: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5 w-28">
                <span className="field-label">Min matches</span>
                <input
                  className="input cursor-text"
                  type="number"
                  min={1}
                  placeholder="all"
                  value={rule.minSignatures}
                  disabled={!canEdit}
                  onChange={e => edit(rule.key, { minSignatures: e.target.value })}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">Must include — a deck missing any of these never matches</span>
              <textarea
                className="input cursor-text resize-y font-mono text-sm"
                rows={Math.max(2, rule.required.split("\n").length)}
                value={rule.required}
                disabled={!canEdit}
                onChange={e => edit(rule.key, { required: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">Signature cards — exact names, one per line</span>
              <textarea
                className="input cursor-text resize-y font-mono text-sm"
                rows={Math.max(2, rule.signatures.split("\n").length)}
                value={rule.signatures}
                disabled={!canEdit}
                onChange={e => edit(rule.key, { signatures: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">Excluded cards — a deck playing any of these never matches</span>
              <textarea
                className="input cursor-text resize-y font-mono text-sm"
                rows={Math.max(2, rule.exclusions.split("\n").length)}
                value={rule.exclusions}
                disabled={!canEdit}
                onChange={e => edit(rule.key, { exclusions: e.target.value })}
              />
            </label>

            {rule.error && <p className="error m-0">{rule.error}</p>}
            {rule.warning && <p className="m-0 text-sm font-medium text-gold">{rule.warning}</p>}

            <div className="flex items-center gap-3">
              <span className="muted text-sm mr-auto">
                {rule.id == null
                  ? "Not saved yet"
                  : `Matches ${(stats.byId[rule.id] ?? 0).toLocaleString()} ${stats.byId[rule.id] === 1 ? "deck" : "decks"}`}
              </span>
              {canEdit && (
                <>
                  <button type="button" className="btn btn-danger" onClick={() => deleteRule(rule)}>
                    Delete
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!rule.dirty || rule.saving}
                    onClick={() => saveRule(rule)}
                  >
                    {rule.saving ? "Saving…" : rule.dirty ? "Save" : "Saved"}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canEdit && (
        <p className="mt-5">
          <button type="button" className="btn btn-soft" onClick={addRule}>
            + Add rule
          </button>
        </p>
      )}
    </div>
  )
}
