import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    "Missing Supabase config. Copy frontend/.env.example to .env.local and fill in the values from `supabase status`."
  )
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})
