import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from './apiKeyOnlyFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const passwordRecoverySupabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Email apps may open links in a browser context that did not request the
    // reset. Implicit recovery links carry a short-lived session in the URL
    // fragment, so the callback can complete in that browser context.
    detectSessionInUrl: false,
    flowType: 'implicit',
    storageKey: 'uvain-password-recovery-auth',
  },
  global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
})
