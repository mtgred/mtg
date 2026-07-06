import { useMemo, useState } from "react"

export type SortDir = "asc" | "desc"
export type SortState<K extends string> = { key: K; dir: SortDir }
type Accessors<T, K extends string> = Record<K, (row: T) => string | number | null>

// Client-side sortable table state. `accessors` maps each sortable column key to
// a value getter; pass a module-level constant so the reference stays stable.
// Nulls always sort last regardless of direction.
export function useSort<T, K extends string>(rows: T[], accessors: Accessors<T, K>, initial: SortState<NoInfer<K>>) {
  const [sort, setSort] = useState<SortState<K>>(initial)
  const sorted = useMemo(() => {
    const get = accessors[sort.key]
    const dir = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, sort, accessors])
  const toggle = (key: K) => setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))
  return { sorted, sort, toggle }
}
