import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { queueCheckinSheetRows } from '../_shared/checkinSheetSync.ts'
import { isMembershipActive } from '../_shared/membershipStatus.js'

const DAILY_STORE_LIMIT_MESSAGE = '오늘은 이미 매장 3곳에서 Check-IN했어요. 내일 다시 이용해 주세요.'

async function findStampRestaurant(admin: any, storeId: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)
  if (isUuid) {
    const { data: byId, error: byIdError } = await admin
      .from('restaurants')
      .select('id, stamp_card_enabled, is_archived')
      .eq('id', storeId)
      .maybeSingle()

    if (byIdError) console.error('Stamp restaurant by id fetch error:', byIdError)
    if (byId) return byId
  }

  const { data: byPartnership, error: byPartnershipError } = await admin
    .from('restaurants')
    .select('id, stamp_card_enabled, is_archived')
    .eq('partnership_id', storeId)
    .maybeSingle()

  if (byPartnershipError) {
    console.warn('Stamp restaurant by partnership_id fetch skipped/failed:', byPartnershipError)
  }

  return byPartnership ?? null
}

async function recordStampCardVisit(admin: any, userId: string, storeId: string) {
  const restaurant = await findStampRestaurant(admin, storeId)
  if (!restaurant?.stamp_card_enabled || restaurant.is_archived) return { enabled: false }

  const { data, error } = await admin.rpc('record_member_stamp_visit', {
    p_user_id: userId,
    p_restaurant_id: restaurant.id,
  })
  if (error) throw error

  const result = Array.isArray(data) ? data[0] : data
  if (!result) throw new Error('Stamp recording returned no result')

  return {
    enabled: result.enabled,
    restaurantId: restaurant.id,
    alreadyStamped: result.already_stamped,
    rewardPending: result.reward_pending,
    success: !result.already_stamped && !result.reward_pending && result.enabled,
    currentCount: result.current_count,
    newCount: result.new_count,
    cardCycle: result.card_cycle,
    cycleCompleted: result.cycle_completed,
    totalStamps: result.total_stamps,
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let testMode = false
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    const { storeId } = await req.json().catch(() => ({}))

    if (!token || !storeId) {
      return new Response(
        JSON.stringify({ success: false, message: '잘못된 요청입니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = getSupabaseServiceKey()

    if (!serviceKey) {
      console.error('No service key found')
      return new Response(
        JSON.stringify({ success: false, message: '서버 설정 오류입니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user

    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(
        JSON.stringify({ success: false, message: '로그인이 필요합니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // The token has been validated by Auth. Read only this user's test marker
    // so early auth/session failures can be labeled without trusting the client.
    const { data: testMember } = await admin
      .from('members')
      .select('is_test_account')
      .eq('user_id', user.id)
      .maybeSingle()
    testMode = testMember?.is_test_account === true

    // Require the server-recorded email OTP login and active device session
    // before any service-role write can grant member functionality.
    if (!hasVerifiedAppLogin(token, user.id)) {
      const response = requireVerifiedLoginResponse(corsHeaders)
      if (!testMode) return response
      const body = await response.json()
      return new Response(JSON.stringify({ ...body, testMode: true }), {
        status: response.status,
        headers: response.headers,
      })
    }
    if (!(await hasActiveDeviceSession(admin, user.id, token, { testAccountEmail: user.email }))) {
      return new Response(
        JSON.stringify({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.', ...(testMode ? { testMode: true } : {}) }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch member profile ───────────────────────────────────────────────
    const [memberResult, partnershipResult, integrationsResult] = await Promise.all([
      admin
        .from('members')
        .select(
          'first_name, last_name, first_name_korean, last_name_korean, University, student_number, major, education_level, year_number, year_of_birth, country_of_origin, gender, membership_valid_until, membership_ended_at, identity_anonymized_at, account_status, is_member, is_test_account',
        )
        .eq('user_id', user.id)
        .single(),
      admin
        .from('partnerships')
        .select('name, sheet_name')
        .eq('id', storeId)
        .single(),
      admin
        .from('partnership_integrations')
        .select('master_apps_script_url, partner_apps_script_url')
        .eq('partnership_id', storeId)
        .maybeSingle(),
    ])
    const { data: member, error: memberError } = memberResult

    if (memberError || !member) {
      console.error('Member error:', memberError)
      return new Response(
        JSON.stringify({ success: false, message: '멤버 정보를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // This flag is derived from the member row on the server. The client never
    // supplies it, and it is only used to label the result screen.
    testMode = member.is_test_account === true
    const failedResult = (message: string) => ({ success: false, message, ...(testMode ? { testMode: true } : {}) })
    const dailyStoreLimitResponse = () => new Response(
      JSON.stringify({ ...failedResult(DAILY_STORE_LIMIT_MESSAGE), code: 'daily_store_limit' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

    // ── Membership validity check ──────────────────────────────────────────
    const now = new Date()
    if (!member.is_member) {
      return new Response(
        JSON.stringify(failedResult('멤버십이 활성화되어 있지 않습니다.')),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!isMembershipActive(member, now)) {
      return new Response(
        JSON.stringify(failedResult('멤버십이 만료되었습니다.')),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch partnership ──────────────────────────────────────────────────
    const { data: partnership, error: partnershipError } = partnershipResult

    if (!partnershipError && partnership) {
      const { data: restaurantStatus, error: restaurantStatusError } = await admin
        .from('restaurants')
        .select('id, is_archived')
        .eq('partnership_id', storeId)
        .maybeSingle()

      if (restaurantStatusError) {
        console.error('Partner status lookup failed')
        return new Response(
          JSON.stringify(failedResult('매장 제휴 상태를 확인하지 못했습니다.')),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      if (restaurantStatus?.is_archived) {
        return new Response(
          JSON.stringify(failedResult('제휴가 종료된 매장입니다.')),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    if (!partnershipError && partnership && member.is_test_account) {
      return new Response(
        JSON.stringify({
          success: true,
          userId: user.id,
          member: {
            first_name: member.first_name,
            last_name: member.last_name,
            student_number: member.student_number,
            University: member.University,
            membership_valid_until: member.membership_valid_until,
            is_member: member.is_member,
          },
          storeName: partnership.name,
          redemptionId: '',
          testMode,
          stampResult: { enabled: false, testMode: true },
          sheetSync: 'not logged (test mode)',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (partnershipError || !partnership) {
      console.error('Partnership error:', partnershipError)
      return new Response(
        JSON.stringify(failedResult('유효하지 않은 제휴 매장입니다.')),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: integrationsError } = integrationsResult
    if (integrationsError) {
      console.error('Partnership integration lookup failed')
      return new Response(
        JSON.stringify(failedResult('매장 연동 설정을 확인하지 못했습니다.')),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // At most 3 different stores per member per day; a store already visited
    // today still works. claim_redemption_window enforces the same limit under
    // a lock, so simultaneous scans cannot get past it.
    const { data: limitReached, error: limitError } = await admin.rpc(
      'checkin_daily_store_limit_reached',
      { p_user_id: user.id, p_store_id: storeId },
    )
    if (limitError) {
      console.error('Daily store limit check failed:', limitError)
      return new Response(
        JSON.stringify(failedResult('매장 이용 기록을 처리하지 못했습니다.')),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    if (limitReached === true) return dailyStoreLimitResponse()

    // Record (or safely recognize) today's visit before claiming the 15-minute
    // redemption window. If stamp persistence fails, return an error without
    // consuming the retry window; the unique daily index handles scan races.
    let stampResult: any
    try {
      stampResult = await recordStampCardVisit(admin, user.id, storeId)
    } catch (stampError) {
      console.error('Stamp card record error:', stampError)
      return new Response(
        JSON.stringify(failedResult('스탬프 기록을 처리하지 못했습니다. 다시 시도해 주세요.')),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    // Reuse the existing check-in according to the RPC's daily limit.
    // Repeated scans confirm that visit without creating another visit log.
    const { data: redemptionClaims, error: claimError } = await admin.rpc(
      'claim_redemption_window',
      { p_user_id: user.id, p_store_id: storeId },
    )

    if (claimError?.message?.includes('daily_store_limit')) return dailyStoreLimitResponse()
    if (claimError) {
      console.error('Redemption window claim failed:', claimError)
      return new Response(
        JSON.stringify(failedResult('매장 이용 기록을 처리하지 못했습니다.')),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const redemptionClaim = Array.isArray(redemptionClaims) ? redemptionClaims[0] : null
    if (!redemptionClaim?.redemption_id) {
      console.error('Redemption window claim returned no record')
      return new Response(
        JSON.stringify(failedResult('매장 이용 기록을 처리하지 못했습니다.')),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const checkinAlreadyRecorded = redemptionClaim.created !== true
    const redemptionId = String(redemptionClaim.redemption_id)
    let redemptionTimestamp = now

    if (checkinAlreadyRecorded) {
      // Retry the idempotent Sheets upsert for the existing event. Preserve
      // its original timestamp so a retry cannot make an old scan look new.
      const { data: existingRedemption, error: existingRedemptionError } = await admin
        .from('redemptions')
        .select('redeemed_at')
        .eq('id', redemptionId)
        .eq('user_id', user.id)
        .eq('store_id', storeId)
        .maybeSingle()

      if (existingRedemptionError || !existingRedemption?.redeemed_at) {
        console.error('Existing redemption lookup failed during Sheets retry')
        return new Response(
          JSON.stringify(failedResult('매장 이용 기록을 다시 불러오지 못했습니다.')),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      redemptionTimestamp = new Date(existingRedemption.redeemed_at)
    }

    // PERF-04: the check-in is already recorded, so the member does not wait
    // for Google Sheets. Its Master/partner rows are queued and sent in the
    // background; anything that fails is re-sent by the sheet retry job.
    const { sending: sheetSync } = await queueCheckinSheetRows(admin, {
      redemptionId,
      storeId,
      stampResult,
    })
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(sheetSync)
    else await sheetSync

    return new Response(
      JSON.stringify({
        success: true,
        userId: user.id,
        member: {
          first_name: member.first_name,
          last_name: member.last_name,
          student_number: member.student_number,
          University: member.University,
          membership_valid_until: member.membership_valid_until,
          is_member: member.is_member,
        },
        storeName: partnership.name,
        redemptionId,
        checkedInAt: redemptionTimestamp.toISOString(),
        checkinAlreadyRecorded,
        stampResult,
        sheetSync: 'background',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('log-redemption fatal error:', err)
    return new Response(
      JSON.stringify({ success: false, message: '서버 오류가 발생했습니다.', ...(testMode ? { testMode: true } : {}) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
