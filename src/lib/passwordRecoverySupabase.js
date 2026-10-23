import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from './apiKeyOnlyFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const passwordRecoverySupabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Email apps may open links in a different browser context. Recovery links
    // carry a short-lived session in the URL fragment so that context can finish
    // the reset without the original browser's PKCE verifier.
    detectSessionInUrl: false,
    flowType: 'implicit',
    storageKey: 'uvain-password-recovery-auth',
  },
  global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
})
