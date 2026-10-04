import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function postJsonToAppsScript(url: string | null | undefined, payload: Record<string, unknown>, label: string) {
  if (!url) {
    console.warn(`Skipping ${label} sheet sync: missing Apps Script URL`)
    return { ok: false, skipped: true, label }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await res.text().catch(() => '')

    if (!res.ok) {
      console.error(`${label} sheet sync failed:`, res.status, text)
      return { ok: false, status: res.status, text, label }
    }

    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Apps Script may return plain text if the deployment is misconfigured.
    }

    if (body && typeof body === 'object' && 'success' in body && !(body as { success?: boolean }).success) {
      console.error(`${label} Apps Script returned failure:`, body)
      return { ok: false, body, label }
    }

    return { ok: true, body, label }
  } catch (error) {
    console.error(`${label} sheet sync threw:`, error)
    return { ok: false, error: error instanceof Error ? error.message : String(error), label }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, message: '인증이 필요합니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Parse body ────────────────────────────────────────────
    const { action, redemption_id, store_id, rating, tags, comment } = await req.json()

    if (!redemption_id || !store_id) {
      return new Response(
        JSON.stringify({ success: false, message: '필수 항목이 누락되었습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Supabase admin client ─────────────────────────────────
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const serviceKey   = getSupabaseServiceKey()

    if (!serviceKey) {
      return new Response(
        JSON.stringify({ success: false, message: '서버 설정 오류입니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    // ── Verify user ───────────────────────────────────────────
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, message: '로그인이 필요합니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Stamp claims are emitted only by redeem-stamp-card-reward after its
    // one-time database state transition. Do not accept client-forged claims.
    if (action === 'stamp_claim') {
      return new Response(
        JSON.stringify({ success: false, message: '리워드 사용 기록은 서버 처리로만 등록할 수 있습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch partnership URLs from Supabase ──────────────────
    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name, master_apps_script_url, partner_apps_script_url')
      .eq('id', store_id)
      .single()

    if (partnershipError || !partnership) {
      console.error('Partnership lookup failed:', partnershipError)
      return new Response(
        JSON.stringify({ success: false, message: '매장 정보를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!rating || !tags) {
      return new Response(
        JSON.stringify({ success: false, message: '필수 항목이 누락되었습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Build review payload for both sheets ──────────────────
    // tags is a raw array e.g. ['GREAT_FOOD', 'GOOD_VALUE']
    const tagsArray: string[] = Array.isArray(tags) ? tags : []

    const reviewPayload = {
      type:           'review',
      partnership_id:  store_id,
      sheet_name:     partnership.sheet_name || partnership.name,
      redemption_id:  String(redemption_id),
      rating:         rating,
      tags:           tagsArray,   // Apps Script reads tags.includes('GREAT_FOOD') etc.
      comment:        comment || '',
    }

    // ── POST to both Apps Scripts ─────────────────────────────
    await Promise.all([
      postJsonToAppsScript(partnership.master_apps_script_url, reviewPayload, 'master'),
      postJsonToAppsScript(partnership.partner_apps_script_url, reviewPayload, 'partner'),
    ])

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('sync-to-sheets fatal error:', err)
    return new Response(
      JSON.stringify({ success: false, message: '서버 오류가 발생했습니다.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
