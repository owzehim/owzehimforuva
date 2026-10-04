import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.ts'
import { getSupabasePublishableKey } from '../_shared/publishableKey.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const confirmationRedirect = 'https://app.uva-in.nl/email-confirmed'

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: 'Method not allowed.' }, 405)

  try {
    const { currentEmail, newEmail, password } = await req.json()
    const oldEmail = normalizeEmail(currentEmail)
    const replacementEmail = normalizeEmail(newEmail)

    if (!oldEmail || !replacementEmail || !String(password || '') || oldEmail === replacementEmail) {
      return json({ success: false, message: 'Please provide a different email address.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const publishableKey = getSupabasePublishableKey()
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return json({ success: false, message: 'Email changes are temporarily unavailable.' }, 500)
    }

    const passwordClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(publishableKey) },
    })
    const { error: passwordError } = await passwordClient.auth.signInWithPassword({
      email: oldEmail,
      password: String(password),
    })
    if (!String(passwordError?.message || '').toLowerCase().includes('email not confirmed')) {
      return json({ success: false, message: 'The email address or password is incorrect.' }, 401)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    let existingUser: { id: string; user_metadata?: Record<string, unknown> } | null = null

    for (let page = 1; page <= 20 && !existingUser; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      existingUser = data.users.find((user) => normalizeEmail(user.email) === oldEmail) || null
      if (data.users.length < 1000) break
    }

    if (!existingUser) return json({ success: false, message: 'Pending registration not found.' }, 404)

    const { data: newAuth, error: createError } = await admin.auth.admin.createUser({
      email: replacementEmail,
      password: String(password),
      email_confirm: false,
      user_metadata: existingUser.user_metadata || {},
    })
    if (createError || !newAuth.user) {
      return json({ success: false, message: createError?.message || 'That email address cannot be used.' }, 400)
    }

    const { error: resendError } = await admin.auth.resend({
      type: 'signup',
      email: replacementEmail,
      options: { emailRedirectTo: confirmationRedirect },
    })
    if (resendError) {
      await admin.auth.admin.deleteUser(newAuth.user.id)
      throw resendError
    }

    const { error: memberError } = await admin
      .from('members')
      .update({ user_id: newAuth.user.id })
      .eq('user_id', existingUser.id)
    if (memberError) {
      await admin.auth.admin.deleteUser(newAuth.user.id)
      throw memberError
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(existingUser.id)
    if (deleteError) throw deleteError

    return json({ success: true })
  } catch (error) {
    console.error('change-pending-email failed:', error)
    return json({ success: false, message: 'Unable to change the email address. Please try again.' }, 500)
  }
})
