import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "../lib/auth"

// Gate for routes that need a signed-in user. Waits for the session to be
// restored before deciding, then redirects to sign in when there is no user.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname + location.search }} replace />
  return <>{children}</>
}
