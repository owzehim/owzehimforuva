import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'
import { queueAndSendReviewSheetRows } from '../_shared/reviewSheetSync.ts'

Deno.serve(async (req) => {
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
      .select('id')
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
    }

    // FUNC-14: queue the Master and partner rows and send them once. A row
    // that fails stays queued and the sheet retry job sends it later, so the
    // review is never lost; the member does not need to try again.
    const { pending } = await queueAndSendReviewSheetRows(admin, {
      redemptionId: redemption.id,
      storeId: redemption.store_id,
    })
    return new Response(
      JSON.stringify({ success: true, sheets: pending === 0 ? 'sent' : 'queued' }),
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
