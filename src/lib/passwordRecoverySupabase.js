import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from './apiKeyOnlyFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const passwordRecoverySupabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // ResetPasswordPage exchanges the code explicitly so other callback routes
    // can never consume this one-time recovery code.
    detectSessionInUrl: false,
    flowType: 'pkce',
    storageKey: 'uvain-password-recovery-auth',
  },
  global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
})
