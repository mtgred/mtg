import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import { useAuth } from "../lib/auth"

// Whether this user already bookmarked the decklist. RLS scopes the table to the owner, so the row's
// mere existence is the answer; anonymous visitors skip the query entirely
async function loadBookmarked(deckId: number, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await supabase
    .from("tournament_deck_bookmarks")
    .select("id")
    .eq("tournament_deck_id", deckId)
    .maybeSingle()
  if (error) throw error
  return data != null
}

// Toggle for saving a tournament decklist. Bookmarking needs an account, so a
// signed-out visitor is sent to sign in and returned here afterwards
export default function BookmarkButton({ deckId }: { deckId: number }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { data } = useAsync(() => loadBookmarked(deckId, user?.id ?? null), [deckId, user?.id])
  // Set once the user toggles, so the button reflects the click before a refetch.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on = toggled ?? data ?? false

  async function toggle() {
    if (!user) {
      navigate("/signin", { state: { from: location.pathname + location.search } })
      return
    }
    setBusy(true)
    setError(null)
    const next = !on
    const { error } = next
      ? await supabase
          .from("tournament_deck_bookmarks")
          .insert({ user_id: user.id, tournament_deck_id: deckId })
      : await supabase.from("tournament_deck_bookmarks").delete().eq("tournament_deck_id", deckId)
    setBusy(false)
    if (error)
      setError(error.message)
    else
      setToggled(next)
  }

  return (
    <>
      <button
        type="button"
        className={`btn justify-center${on ? "" : " btn-soft"}`}
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
      >
        <span className="grid">
          <span className="col-start-1 row-start-1">{on ? "Bookmarked" : "Bookmark"}</span>
          <span className="col-start-1 row-start-1 invisible" aria-hidden>Bookmarked</span>
        </span>
      </button>
      {error && <span className="error">{error}</span>}
    </>
  )
}
