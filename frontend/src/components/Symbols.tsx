import { Fragment } from "react"

// Scryfall serves an SVG for every mana/game symbol. The filename is the symbol
// code with the braces and slash stripped: {2/W} -> 2W.svg, {T} -> T.svg.
function symbolUrl(code: string): string {
  return `https://svgs.scryfall.io/card-symbols/${code.replace(/\//g, "")}.svg`
}

const TOKEN = /(\{[^}]+\})/g

type Props = {
  // Any text that may contain {…} symbols: a mana cost like "{1}{R}" or full
  // oracle text with inline symbols.
  text: string | null | undefined
  className?: string
}

// Renders text with embedded {…} tokens replaced by their symbol icons.
export function Symbols({ text, className }: Props) {
  if (!text) return null

  const parts = text.split(TOKEN).filter(Boolean)

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const match = /^\{([^}]+)\}$/.exec(part)
        if (match) {
          const code = match[1]
          return <img key={i} className="symbol" src={symbolUrl(code)} alt={code} title={code} loading="lazy" />
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </span>
  )
}

// Oracle text with paragraph breaks preserved; each line may contain symbols.
export function OracleText({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return (
    <div className="oracle-text">
      {text.split("\n").map((line, i) => (
        <p key={i}>
          <Symbols text={line} />
        </p>
      ))}
    </div>
  )
}
