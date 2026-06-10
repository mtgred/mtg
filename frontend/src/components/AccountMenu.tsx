import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAuth } from "../lib/auth"

// Topbar account area: sign in / sign up links when signed out, or the user's
// email with a sign-out action in a dropdown when signed in.
export default function AccountMenu() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside the menu.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  async function signOut() {
    setOpen(false)
    await supabase.auth.signOut()
    navigate("/")
  }

  // Avoid flashing the signed-out links before the session is restored.
  if (loading) return null

  if (!user) {
    return (
      <div className="account">
        <Link to="/signin" className="navlink">
          Sign in
        </Link>
        <Link to="/signup" className="navlink account-cta">
          Sign up
        </Link>
      </div>
    )
  }

  const label = user.email ?? "Account"

  return (
    <div className="cardsmenu account" ref={rootRef}>
      <button
        type="button"
        className={`navlink${open ? " is-active" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="account-avatar" aria-hidden="true">
          {label.charAt(0).toUpperCase()}
        </span>
        <svg className="cardsmenu-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="cardsmenu-menu account-menu" role="menu">
          <p className="account-email" title={label}>
            {label}
          </p>
          <button type="button" className="cardsmenu-item account-signout" role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
