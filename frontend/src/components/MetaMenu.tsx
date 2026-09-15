import { useEffect, useRef, useState } from "react"
import { BsChevronDown } from "react-icons/bs"
import { NavLink, useLocation } from "react-router-dom"
import { supabase } from "../lib/supabase"
import { useAsync } from "../lib/useAsync"
import type { Format } from "../lib/types"

async function loadFormats(): Promise<Pick<Format, "code" | "name">[]> {
  const { data, error } = await supabase
    .from("formats")
    .select("code,name,sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as Pick<Format, "code" | "name">[]
}

// Topbar "Meta" dropdown: pick a format to jump to its metagame page.
export default function MetaMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const { data: formats } = useAsync(loadFormats, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // The current format is the first path segment when it matches a known code.
  const seg = location.pathname.split("/")[1] ?? ""
  const current = (formats ?? []).find(f => f.code === seg)
  const active = !!current

  return (
    <div className="cardsmenu" ref={rootRef}>
      <button
        type="button"
        className={`navlink${active ? " is-active" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {current ? `${current.name}` : "Meta"}
        <BsChevronDown className="cardsmenu-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="cardsmenu-menu" role="menu">
          {(formats ?? []).map(f => (
            <NavLink
              key={f.code}
              to={`/${f.code}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={({ isActive }) => `cardsmenu-item${isActive ? " is-active" : ""}`}
            >
              {f.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
