import { useFocusShortcut } from "../lib/useFocusShortcut"

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

// Filter box used in page headers. Pressing "/" focuses it from anywhere; the
// hint badge advertises the shortcut and hides once focused or filled.
export default function FilterInput({ value, onChange, placeholder }: Props) {
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
      />
      <kbd className="search-hint" aria-hidden="true">
        /
      </kbd>
    </div>
  )
}
