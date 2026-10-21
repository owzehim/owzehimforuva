import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { sheetText } from '../_shared/sheetText.js'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'
import { getAllowedAppsScriptUrl, withAppsScriptSecret } from '../_shared/appsScriptAuth.js'

async function postJsonToAppsScript(url: string | null | undefined, payload: Record<string, unknown>, label: string) {
  if (!url) return { ok: false, skipped: true, label }
  const endpoint = getAllowedAppsScriptUrl(url)
  if (!endpoint) {
    console.error(`${label} Apps Script URL is invalid`)
    return { ok: false, errorCode: 'invalid_endpoint', label }
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withAppsScriptSecret(
        payload,
        Deno.env.get(label === 'master' ? 'MASTER_APPS_SCRIPT_SECRET' : 'PARTNER_APPS_SCRIPT_SECRET'),
      )),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      console.error(`${label} sheet sync failed:`, response.status)
      return { ok: false, label }
    }
    try {
      const result = text ? JSON.parse(text) : null
      if (result && typeof result === 'object' && result.success === false) return { ok: false, label }
    } catch {
      // Apps Script deployments can return plain text on errors.
    }
    return { ok: true, label }
  } catch {
    console.error(`${label} sheet sync failed unexpectedly`)
    return { ok: false, label }
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
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
    let body: Record<string, unknown>
    try {
      body = await readJsonBody(req, 16_384) as Record<string, unknown>
    } catch (bodyError) {
      const status = bodyError instanceof RequestBodyTooLargeError ? 413 : 400
      return new Response(
        JSON.stringify({ success: false, message: status === 413 ? '요청 크기가 너무 큽니다.' : '잘못된 요청입니다.' }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const redemption_id = body?.redemption_id
    const shouldUpdateReviewComment = body?.update_review_comment === true
    const requestedReviewComment = typeof body?.comment === 'string'
      ? body.comment.trim().slice(0, 200)
      : undefined

    if ((typeof redemption_id !== 'string' && typeof redemption_id !== 'number') || !/^[1-9]\d{0,17}$/.test(String(redemption_id))) {
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
    if (!hasVerifiedAppLogin(token, userData.user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, userData.user.id, token))) {
      return new Response(
        JSON.stringify({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const userId = userData.user.id
    const { data: redemption, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, user_id, store_id')
      .eq('id', String(redemption_id))
      .eq('user_id', userId)
      .maybeSingle()

    if (redemptionError || !redemption) {
      console.warn('Review sync denied: redemption is missing or not owned by caller')
      return new Response(
        JSON.stringify({ success: false, message: '이 이용 기록에 대한 권한이 없습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: review, error: reviewError } = await admin
      .from('reviews')
      .select('rating, tags, comment')
      .eq('redemption_id', redemption.id)
      .eq('user_id', userId)
      .maybeSingle()

    if (reviewError || !review) {
      console.warn('Review sync denied: no review owned by caller for redemption')
      return new Response(
        JSON.stringify({ success: false, message: '저장된 리뷰를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name')
      .eq('id', redemption.store_id)
      .maybeSingle()
    const { data: integrations, error: integrationsError } = await admin
      .from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', redemption.store_id)
      .maybeSingle()
    if (partnershipError || integrationsError || !partnership) {
      console.error('Review sheet configuration lookup failed')
      return new Response(
        JSON.stringify({ success: false, message: '매장 연동 설정을 확인하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (shouldUpdateReviewComment) {
      const { error: updateCommentError } = await admin
        .from('reviews')
        .update({ comment: requestedReviewComment?.trim() || null })
        .eq('redemption_id', redemption.id)
        .eq('user_id', userId)

      if (updateCommentError) {
        console.error('Review comment update failed:', updateCommentError)
        return new Response(
          JSON.stringify({ success: false, message: '리뷰 한마디를 수정하지 못했습니다.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      review.comment = requestedReviewComment?.trim() || null
    }

    const rating = Number(review.rating)
    const validTags = new Set(['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE'])
    const tags = Array.isArray(review.tags)
      ? review.tags.filter((tag: unknown) => typeof tag === 'string' && validTags.has(tag)).slice(0, 4)
      : []
    const now = new Date()
    const reviewPayload = {
      type: 'review',
      partnership_id: redemption.store_id,
      sheet_name: sheetText(partnership.sheet_name || partnership.name, 160),
      redemption_id: String(redemption_id),
      rating,
      tags,
      comment: sheetText(review.comment || '', 2000),
      review_submitted_at_date: now.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' }),
      review_submitted_at_time: now.toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
      }),
    }
    const masterSync = await postJsonToAppsScript(
      integrations?.master_apps_script_url,
      reviewPayload,
      'master',
    )
    let partnerSync: { ok: boolean; skipped?: boolean; label: string } = {
      ok: true,
      skipped: true,
      label: 'partner',
    }
    if (integrations?.partner_apps_script_url) {
      // Send the per-redemption rating and tags to the partner's Operations tab.
      // Reviewer identity and comment stay in the internal Master sheet only.
      partnerSync = await postJsonToAppsScript(
        integrations.partner_apps_script_url,
        {
          type: 'review',
          partnership_id: redemption.store_id,
          redemption_id: String(redemption_id),
          rating,
          tags,
          review_submitted_at_date: now.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' }),
        },
        'partner',
      )
    }
    if (!masterSync.ok || !partnerSync.ok) {
      return new Response(
        JSON.stringify({ success: false, message: '리뷰 기록을 모두 동기화하지 못했습니다.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

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
