import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabase"

type Mode = "signin" | "signup"

const copy = {
  signin: {
    title: "Sign in",
    submit: "Sign in",
    busy: "Signing in…",
    altPrompt: "Need an account?",
    altLabel: "Sign up",
    altTo: "/signup",
  },
  signup: {
    title: "Create account",
    submit: "Sign up",
    busy: "Creating account…",
    altPrompt: "Already have an account?",
    altLabel: "Sign in",
    altTo: "/signin",
  },
} as const

export default function AuthForm({ mode }: { mode: Mode }) {
  const t = copy[mode]
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        // When email confirmation is required no session is returned, so the
        // user must verify before they can sign in.
        if (!data.session) {
          setNotice("Check your email to confirm your account, then sign in.")
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
      navigate("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">{t.title}</h1>

        <label className="auth-field">
          <span>Email</span>
          <input
            className="search"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input
            className="search"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error && <p className="error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? t.busy : t.submit}
        </button>

        <p className="auth-alt">
          {t.altPrompt} <Link to={t.altTo}>{t.altLabel}</Link>
        </p>
      </form>
    </div>
  )
}
