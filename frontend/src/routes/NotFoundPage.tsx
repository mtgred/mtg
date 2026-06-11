import { Link } from "react-router-dom"

export default function NotFoundPage() {
  return (
    <div className="page not-found">
      <h1>Page not found</h1>
      <p className="muted">We couldn’t find what you were looking for. It may have moved or never existed.</p>
      <p>
        <Link to="/">Back to Manaring</Link>
      </p>
    </div>
  )
}
