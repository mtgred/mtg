import { useEffect, useState } from "react"

type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

// Runs an async loader and tracks loading/error state. `deps` controls re-runs
// (same contract as useEffect). Guards against setting state after unmount or a
// superseded request.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })

  useEffect(() => {
    let active = true
    // Reset to a loading state when the request changes; the rule's general
    // advice does not apply to data-fetching effects that re-sync on deps.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ data: null, loading: true, error: null })
    loader()
      .then(data => {
        if (active) setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (active) setState({ data: null, loading: false, error: messageOf(err) })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  // Supabase/PostgREST errors are plain objects with a `message`, not Error instances.
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message
  }
  return "Something went wrong."
}
