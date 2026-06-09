import { useEffect, useRef } from "react"

// Returns a ref that focuses (and selects) its input when the user presses
// `key` while not already typing in a field. Mirrors the global shortcut in
// CardSearch, but for a single bare key like "/".
export function useFocusShortcut<T extends HTMLInputElement>(key: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      ref.current?.focus()
      ref.current?.select()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [key])
  return ref
}
