import { useFocusShortcut } from "../lib/useFocusShortcut"

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  // When given, Enter commits the current value — for filters too costly to run
  // on every keystroke.
  onEnter?: (value: string) => void
}

// Filter box used in page headers. Pressing "/" focuses it from anywhere; the
// hint badge advertises the shortcut and hides once focused or filled.
export default function FilterInput({ value, onChange, placeholder, onEnter }: Props) {
  const ref = useFocusShortcut<HTMLInputElement>("/")
  return (
    <div className="search-field">
      <input
        ref={ref}
        className="search"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter?.(e.currentTarget.value)}
      />
      <kbd className="search-hint" aria-hidden="true">
        /
      </kbd>
    </div>
  )
}
