import { createContext, use } from "react"
import type { Session, User } from "@supabase/supabase-js"

export type AuthState = {
  // null while the initial session is still being restored.
  session: Session | null
  user: User | null
  loading: boolean
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
