import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { sheetText } from '../_shared/sheetText.js'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'

async function postJsonToAppsScript(url: string | null | undefined, payload: Record<string, unknown>, label: string) {
  if (!url) {
    console.warn(`Skipping ${label} sheet sync: missing Apps Script URL`)
    return { ok: false, skipped: true, label }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withAppsScriptSecret(payload, Deno.env.get('APPS_SCRIPT_SHARED_SECRET'))),
    })
    const text = await res.text().catch(() => '')

    if (!res.ok) {
      // Apps Script error bodies can echo submitted member data; keep them out
      // of Edge Function logs and client-visible response objects.
      console.error(`${label} sheet sync failed:`, res.status)
      return { ok: false, status: res.status, label }
    }

    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Apps Script may return plain text if the deployment is misconfigured.
    }

    if (body && typeof body === 'object' && 'success' in body && !(body as { success?: boolean }).success) {
      console.error(`${label} Apps Script returned failure`)
      return { ok: false, label }
    }

    return { ok: true, body, label }
  } catch (error) {
    console.error(`${label} sheet sync threw:`, error)
    return { ok: false, error: error instanceof Error ? error.message : String(error), label }
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

    // ── Fetch public store details and private webhook URLs ───
    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name')
      .eq('id', redemption.store_id)
      .single()

    if (partnershipError || !partnership) {
      console.error('Partnership lookup failed:', partnershipError)
      return new Response(
        JSON.stringify({ success: false, message: '매장 정보를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: integrations, error: integrationsError } = await admin
      .from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', redemption.store_id)
      .maybeSingle()

    if (integrationsError) {
      console.error('Partnership integration lookup failed:', integrationsError)
      return new Response(
        JSON.stringify({ success: false, message: '매장 연동 설정을 확인하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const rating = Number(review.rating)
    const validTags = new Set(['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE'])
    const tagsArray = Array.isArray(review.tags)
      ? review.tags.filter((tag: unknown) => typeof tag === 'string' && validTags.has(tag)).slice(0, 4)
      : []
    if (!Number.isInteger(rating * 2) || rating < 0.5 || rating > 5) {
      return new Response(
        JSON.stringify({ success: false, message: '필수 항목이 누락되었습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Build review payload for both sheets ──────────────────
    const reviewPayload = {
      type:           'review',
      partnership_id:  redemption.store_id,
      sheet_name:     sheetText(partnership.sheet_name || partnership.name, 160),
      redemption_id:  String(redemption_id),
      rating:         rating,
      tags:           tagsArray,   // Apps Script reads tags.includes('GREAT_FOOD') etc.
      comment:        sheetText(review.comment, 2000),
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
      reviewPayload.comment = sheetText(review.comment, 2000)
    }

    // Partner-owned trackers can be shared with restaurant staff. Keep free-
    // text review content in the master sheet only; it may identify a member.
    const partnerReviewPayload = { ...reviewPayload, comment: '' }

    // ── POST to both Apps Scripts ─────────────────────────────
    const syncResults = await Promise.all([
      postJsonToAppsScript(integrations?.master_apps_script_url, reviewPayload, 'master'),
      postJsonToAppsScript(integrations?.partner_apps_script_url, partnerReviewPayload, 'partner'),
    ])

    const requiredSyncFailed = shouldUpdateReviewComment
      ? !syncResults[0]?.ok
      : syncResults.some((result) => !result.ok)
    if (requiredSyncFailed) {
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
