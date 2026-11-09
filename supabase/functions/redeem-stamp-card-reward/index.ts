import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { isMembershipActive } from '../_shared/membershipStatus.js'
import { queueRewardClaimSheetRows } from '../_shared/rewardClaimSheetSync.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return json({ success: false, message: '로그인이 필요합니다.' }, 401)

    const body = await req.json().catch(() => null)
    const rewardId = body?.rewardId
    const redemptionId = body?.redemptionId
    const storeId = body?.storeId
    if (
      typeof rewardId !== 'string' ||
      !UUID_PATTERN.test(rewardId) ||
      (typeof redemptionId !== 'string' && typeof redemptionId !== 'number') ||
      !/^[1-9]\d{0,17}$/.test(String(redemptionId)) ||
      typeof storeId !== 'string' ||
      storeId.length === 0 ||
      storeId.length > 200 ||
      storeId.trim() !== storeId ||
      // deno-lint-ignore no-control-regex -- rejecting control characters is the point
      /[\u0000-\u001f\u007f]/.test(storeId)
    ) {
      return json({ success: false, message: '잘못된 리워드 사용 요청입니다.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Supabase service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userError || !user) return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    if (!hasVerifiedAppLogin(token, user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, userData.user.id, token))) {
      return new Response(
        JSON.stringify({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: member, error: memberError } = await admin
      .from('members')
      .select('is_member, account_status, identity_anonymized_at, membership_valid_until')
      .eq('user_id', user.id)
      .maybeSingle()

    if (memberError) {
      console.error('Membership status lookup failed:', memberError)
      return json({ success: false, message: '멤버십 상태를 확인하지 못했습니다.' }, 500)
    }
    if (!isMembershipActive(member)) {
      return json({ success: false, message: '현재 사용할 수 있는 멤버십이 아닙니다.' }, 403)
    }

    const { data: reward, error: rewardError } = await admin
      .from('stamp_card_rewards')
      .select('id, restaurant_id, redeemed, expires_at')
      .eq('id', rewardId)
      .eq('user_id', user.id)
      .eq('redeemed', false)
      .is('expires_at', null)
      .maybeSingle()

    if (rewardError) {
      console.error('Reward lookup failed:', rewardError)
      return json({ success: false, message: '리워드 상태를 확인하지 못했습니다.' }, 500)
    }
    if (!reward) return json({ success: false, message: '사용 가능 리워드를 찾을 수 없습니다.' }, 404)

    // A reward can only be consumed in the context of this member's
    // server-recorded check-in at the same store today (Europe/Amsterdam), so
    // it can also be applied from the "Already Checked-IN" screen.
    const { data: redemption, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, store_id, redeemed_at')
      .eq('id', String(redemptionId))
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .lte('redeemed_at', new Date().toISOString())
      .maybeSingle()

    if (redemptionError) {
      console.error('Check-in validation failed:', redemptionError)
      return json({ success: false, message: '최근 매장 방문을 확인하지 못했습니다.' }, 500)
    }
    const amsterdamDay = (value: string | Date) =>
      new Date(value).toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
    if (!redemption || amsterdamDay(redemption.redeemed_at) !== amsterdamDay(new Date())) {
      return json({ success: false, message: '오늘 이 매장의 체크인을 확인할 수 없습니다.' }, 403)
    }

    let restaurantId: string | null = null
    if (UUID_PATTERN.test(storeId)) {
      const { data: restaurantById, error: restaurantLookupError } = await admin
        .from('restaurants')
        .select('id, is_archived')
        .eq('id', storeId)
        .maybeSingle()

      if (restaurantLookupError) {
        console.error('Restaurant lookup failed:', restaurantLookupError)
        return json({ success: false, message: '매장 정보를 확인하지 못했습니다.' }, 500)
      }
      if (restaurantById?.is_archived) {
        return json({ success: false, message: '제휴 종료로 사용할 수 없는 리워드입니다.' }, 403)
      }
      restaurantId = restaurantById?.id ?? null
    }

    if (!restaurantId) {
      const { data: restaurantByPartnership, error: partnershipLookupError } = await admin
        .from('restaurants')
        .select('id, is_archived')
        .eq('partnership_id', storeId)
        .maybeSingle()

      if (partnershipLookupError) {
        console.error('Partner restaurant lookup failed:', partnershipLookupError)
        return json({ success: false, message: '매장 정보를 확인하지 못했습니다.' }, 500)
      }
      if (restaurantByPartnership?.is_archived) {
        return json({ success: false, message: '제휴 종료로 사용할 수 없는 리워드입니다.' }, 403)
      }
      restaurantId = restaurantByPartnership?.id ?? null
    }

    if (!restaurantId || restaurantId !== reward.restaurant_id) {
      return json({ success: false, message: '이 매장에서 사용할 수 있는 리워드가 아닙니다.' }, 403)
    }

    // The redeemed=false predicate makes this a one-way, atomic state change:
    // concurrent or repeated claims can update the reward only once.
    const claimedAt = new Date()
    const { data: updatedReward, error: updateError } = await admin
      .from('stamp_card_rewards')
      .update({ redeemed: true, redeemed_at: claimedAt.toISOString() })
      .eq('id', rewardId)
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .eq('redeemed', false)
      .is('expires_at', null)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Reward update failed:', updateError)
      return json({ success: false, message: '리워드 사용 처리에 실패했습니다.' }, 500)
    }
    if (!updatedReward) {
      return json({ success: false, message: '이 리워드는 이미 사용되었습니다.' }, 409)
    }

    // PERF-04: the reward is used. Queue its Master/partner Sheet rows and
    // send them in the background; anything that fails is re-sent by the
    // sheet retry job, so staff never wait for Google Sheets.
    const { queued, sending } = await queueRewardClaimSheetRows(admin, {
      rewardId,
      storeId,
      redemptionId: redemption.id,
      claimedAt,
    })
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(sending)
    else await sending

    return json({ success: true, sheetSync: queued ? 'queued' : 'not_queued' })
  } catch (error) {
    console.error('Unexpected reward redemption error:', error)
    return json({ success: false, message: '리워드 사용 처리에 실패했습니다.' }, 500)
  }
})
