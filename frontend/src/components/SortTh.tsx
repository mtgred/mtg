import { BsCaretDownFill, BsCaretUpFill } from "react-icons/bs"
import type { SortState } from "../lib/useSort"

// A clickable table header cell that reflects and toggles the current sort.
export function SortTh<K extends string>({
  col,
  sort,
  toggle,
  children,
  className,
}: {
  col: K
  sort: SortState<K>
  toggle: (key: K) => void
  children: React.ReactNode
  className?: string
}) {
  const active = sort.key === col
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className="sort-th" onClick={() => toggle(col)}>
        {children}
        <span className="sort-arrow">{active && (sort.dir === "asc" ? <BsCaretUpFill /> : <BsCaretDownFill />)}</span>
      </button>
    </th>
  )
}
