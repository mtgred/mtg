import { useEffect, useRef, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"

// Groups the Sets and Artists links under a single "Cards" topbar dropdown.
export default function CardsMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  // Close when clicking outside the menu.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const active =
    location.pathname.startsWith("/sets") ||
    location.pathname.startsWith("/artists") ||
    location.pathname.startsWith("/formats")

  return (
    <div className="cardsmenu" ref={rootRef}>
      <button
        type="button"
        className={`navlink${active ? " is-active" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Cards
        <svg className="cardsmenu-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="cardsmenu-menu" role="menu">
          <NavLink to="/sets" role="menuitem" onClick={() => setOpen(false)} className={({ isActive }) => `cardsmenu-item${isActive ? " is-active" : ""}`}>
            Sets
          </NavLink>
          <NavLink to="/artists" role="menuitem" onClick={() => setOpen(false)} className={({ isActive }) => `cardsmenu-item${isActive ? " is-active" : ""}`}>
            Artists
          </NavLink>
          <NavLink to="/formats" role="menuitem" onClick={() => setOpen(false)} className={({ isActive }) => `cardsmenu-item${isActive ? " is-active" : ""}`}>
            Formats
          </NavLink>
        </div>
      )}
    </div>
  )
}
