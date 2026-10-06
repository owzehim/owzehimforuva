import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from './apiKeyOnlyFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
})
