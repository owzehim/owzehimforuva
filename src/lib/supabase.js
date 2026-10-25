import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from './apiKeyOnlyFetch'
import { shouldAutoDetectSessionInUrl } from '../domain/auth/authUrl'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: shouldAutoDetectSessionInUrl(
      typeof window === 'undefined' ? '/' : window.location.pathname,
      typeof window === 'undefined' ? '' : window.location.search,
      typeof window === 'undefined' ? '' : window.location.hash,
    ),
  },
  global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
})
