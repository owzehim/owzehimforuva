import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retention-secret',
}

async function postJsonToAppsScript(url: string, payload: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Apps Script failed with ${res.status}: ${text}`)
  }

  if (!text) return null

  try {
    const body = JSON.parse(text)
    if (body && body.success === false) {
      throw new Error(`Apps Script returned failure: ${text}`)
    }
    return body
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Apps Script returned failure')) {
      throw error
    }
    return text
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const expectedSecret = Deno.env.get('RETENTION_JOB_SECRET')
    const suppliedSecret = req.headers.get('x-retention-secret')

    if (!expectedSecret || suppliedSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ success: false, message: 'Unauthorized retention job request' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    const masterAppsScriptUrl = Deno.env.get('MASTER_SHEET_APPS_SCRIPT_URL')

    if (!supabaseUrl || !serviceKey || !masterAppsScriptUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Missing SUPABASE_URL, service role key, or MASTER_SHEET_APPS_SCRIPT_URL',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: anonymizedUsers, error } = await admin.rpc('anonymize_expired_members_for_sheets')

    if (error) {
      console.error('Retention RPC failed:', error)
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const users = Array.isArray(anonymizedUsers) ? anonymizedUsers : []
    const sheetResults = []

    for (const row of users) {
      const userId = typeof row === 'string' ? row : row?.anonymized_user_id || row?.user_id
      if (!userId) continue

      try {
        const body = await postJsonToAppsScript(masterAppsScriptUrl, {
          type: 'privacy_anonymize',
          user_id: userId,
        })
        sheetResults.push({ user_id: userId, success: true, body })
      } catch (sheetError) {
        console.error('Master Sheet privacy sync failed:', userId, sheetError)
        sheetResults.push({
          user_id: userId,
          success: false,
          error: sheetError instanceof Error ? sheetError.message : String(sheetError),
        })
      }
    }

    const failedSheetSyncs = sheetResults.filter((result) => !result.success)

    return new Response(
      JSON.stringify({
        success: failedSheetSyncs.length === 0,
        anonymized_count: users.length,
        sheet_synced_count: sheetResults.length - failedSheetSyncs.length,
        sheet_failed_count: failedSheetSyncs.length,
        sheet_results: sheetResults,
      }),
      {
        status: failedSheetSyncs.length === 0 ? 200 : 207,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    console.error('privacy-retention-sync fatal error:', err)
    return new Response(
      JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
