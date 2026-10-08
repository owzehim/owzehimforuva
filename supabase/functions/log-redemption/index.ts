import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { sheetText } from '../_shared/sheetText.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { isMembershipActive } from '../_shared/membershipStatus.js'

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
      // Apps Script sometimes returns plain text on deployment/configuration errors.
    }

    if (body && typeof body === 'object' && 'success' in body && !(body as { success?: boolean }).success) {
      console.error(`${label} Apps Script returned failure`)
      return { ok: false, label }
    }

    return { ok: true, body, label }
  } catch (error) {
    // Do not retain exception text in results that may later be returned to
    // callers; fetch errors can include the integration URL or other details.
    console.error(`${label} sheet sync failed unexpectedly`)
    return { ok: false, label }
  }
}

function formatStampStatus(stampResult: any) {
  if (!stampResult?.enabled) return ''

  if (stampResult.rewardPending) return 'reward pending'
  if (stampResult.cycleCompleted) return 'ready to claim'
  if (stampResult.alreadyStamped) return 'already stamped today'
  return ''
}

function formatStampProgress(stampResult: any) {
  if (!stampResult?.enabled) return ''

  const totalStamps = Math.max(1, Number(stampResult.totalStamps || 10))
  const count = stampResult.rewardPending || stampResult.cycleCompleted
    ? totalStamps
    : Number(stampResult.newCount ?? stampResult.currentCount ?? 0)

  return `${Math.max(0, count)}/${totalStamps}`
}

async function findStampRestaurant(admin: any, storeId: string) {
  const { data: byId, error: byIdError } = await admin
    .from('restaurants')
    .select('id, stamp_card_enabled')
    .eq('id', storeId)
    .maybeSingle()

  if (byIdError) console.error('Stamp restaurant by id fetch error:', byIdError)
  if (byId) return byId

  const { data: byPartnership, error: byPartnershipError } = await admin
    .from('restaurants')
    .select('id, stamp_card_enabled')
    .eq('partnership_id', storeId)
    .maybeSingle()

  if (byPartnershipError) {
    console.warn('Stamp restaurant by partnership_id fetch skipped/failed:', byPartnershipError)
  }

  return byPartnership ?? null
}

async function recordStampCardVisit(admin: any, userId: string, storeId: string) {
  const restaurant = await findStampRestaurant(admin, storeId)
  if (!restaurant?.stamp_card_enabled) return { enabled: false }

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

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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

    // Require the server-recorded email OTP login and active device session
    // before any service-role query or write can grant member functionality.
    if (!hasVerifiedAppLogin(token, user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, user.id, token))) {
      return new Response(
        JSON.stringify({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch member profile ───────────────────────────────────────────────
    const { data: member, error: memberError } = await admin
      .from('members')
      .select(
        'first_name, last_name, first_name_korean, last_name_korean, University, student_number, major, education_level, year_number, year_of_birth, country_of_origin, gender, membership_valid_until, membership_ended_at, identity_anonymized_at, account_status, is_member, is_test_account',
      )
      .eq('user_id', user.id)
      .single()

    if (memberError || !member) {
      console.error('Member error:', memberError)
      return new Response(
        JSON.stringify({ success: false, message: '멤버 정보를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Membership validity check ──────────────────────────────────────────
    const now = new Date()
    if (!member.is_member) {
      return new Response(
        JSON.stringify({ success: false, message: '멤버십이 활성화되어 있지 않습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!isMembershipActive(member, now)) {
      return new Response(
        JSON.stringify({ success: false, message: '멤버십이 만료되었습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch partnership ──────────────────────────────────────────────────
    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name')
      .eq('id', storeId)
      .single()

    if (!partnershipError && partnership && member.is_test_account) {
      return new Response(
        JSON.stringify({
          success: true,
          storeName: partnership.name,
          redemptionId: '',
          testMode: true,
          stampResult: { enabled: false, testMode: true },
          sheetResults: [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (partnershipError || !partnership) {
      console.error('Partnership error:', partnershipError)
      return new Response(
        JSON.stringify({ success: false, message: '유효하지 않은 제휴 매장입니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Date / time (Amsterdam) ────────────────────────────────────────────
    const date = now.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' })
    const time = now.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Amsterdam',
      hour: '2-digit',
      minute: '2-digit',
    })

    // ── Safe field helpers ─────────────────────────────────────────────────
    const safe = (v: unknown) => (v != null && v !== '' ? sheetText(v) : '')

    // Record (or safely recognize) today's visit before claiming the 15-minute
    // redemption window. If stamp persistence fails, return an error without
    // consuming the retry window; the unique daily index handles scan races.
    let stampResult
    try {
      stampResult = await recordStampCardVisit(admin, user.id, storeId)
    } catch (stampError) {
      console.error('Stamp card record error:', stampError)
      return new Response(
        JSON.stringify({ success: false, message: '스탬프 기록을 처리하지 못했습니다. 다시 시도해 주세요.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const { data: integrations, error: integrationsError } = await admin
      .from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', storeId)
      .maybeSingle()

    if (integrationsError) {
      console.error('Partnership integration lookup failed:', integrationsError)
      return new Response(
        JSON.stringify({ success: false, message: '매장 연동 설정을 확인하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Atomically claim this user's 15-minute window. The database lock
    // ensures only one scan creates a redemption/Sheets event in that window.
    const { data: redemptionClaims, error: claimError } = await admin.rpc(
      'claim_redemption_window',
      { p_user_id: user.id, p_store_id: storeId },
    )

    if (claimError) {
      console.error('Redemption window claim failed:', claimError)
      return new Response(
        JSON.stringify({ success: false, message: '매장 이용 기록을 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const redemptionClaim = Array.isArray(redemptionClaims) ? redemptionClaims[0] : null
    if (!redemptionClaim?.redemption_id) {
      console.error('Redemption window claim returned no record')
      return new Response(
        JSON.stringify({ success: false, message: '매장 이용 기록을 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const reuseRecent = redemptionClaim.created !== true
    const redemptionId = String(redemptionClaim.redemption_id)

    if (reuseRecent) {
      // No new DB row, no Google Sheets POST — just return success
      return new Response(
        JSON.stringify({
          success: true,
          storeName: partnership.name,
          redemptionId,
          stampResult,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Master sheet payload ───────────────────────────────────────────────
    const masterPayload = {
  type: 'master',
  date,
  time,

  redemption_id: redemptionId,
  restaurant_id: storeId,
  place_name: sheetText(partnership.name, 160),

  user_id: user.id,
  first_name: safe(member.first_name),
  last_name: safe(member.last_name),
  first_name_korean: safe(member.first_name_korean),
  last_name_korean: safe(member.last_name_korean),
  university: safe(member.University),
  student_number: safe(member.student_number),
  education_level: safe(member.education_level),
  year_number: member.year_number ?? '',
  major: safe(member.major),
  gender: safe(member.gender),
  year_of_birth: safe(member.year_of_birth),
  country_of_origin: safe(member.country_of_origin),

  star_rating: '',
  great_food: '',
  friendly_staff: '',
  nice_atmosphere: '',
  good_value: '',
  comment: '',

  stamp_status: formatStampStatus(stampResult),
  stamp_progress: formatStampProgress(stampResult),
  stamp_card_progress: formatStampProgress(stampResult),
  stamp_card_claimed_after_scan: stampResult?.claimedAfterScan ? 'Yes' : 'No',

  account_status: safe(member.account_status) || 'active',
  membership_valid_until: safe(member.membership_valid_until),
  membership_ended_at: safe(member.membership_ended_at),
  identity_anonymized_at: safe(member.identity_anonymized_at),
};

    // ── Partner sheet payload ──────────────────────────────────────────────
    const storePayload = {
      type: 'store',
      partnership_id: storeId,
      sheet_name: sheetText(partnership.sheet_name || partnership.name, 160),
      date,
      redemption_id: redemptionId,
      place_name: sheetText(partnership.name, 160),
      stamp_status: formatStampStatus(stampResult),
      stamp_progress: formatStampProgress(stampResult),
      stamp_card_progress: formatStampProgress(stampResult),
      stamp_card_claimed_after_scan: stampResult?.claimedAfterScan ? 'Yes' : 'No',
    }

    const sheetResults = await Promise.all([
      postJsonToAppsScript(integrations?.master_apps_script_url, masterPayload, 'master'),
      postJsonToAppsScript(integrations?.partner_apps_script_url, storePayload, 'partner'),
    ])
    const safeSheetResults = sheetResults.map(({ ok, skipped, label }) => ({ ok, skipped, label }))

    return new Response(
      JSON.stringify({
        success: true,
        storeName: partnership.name,
        redemptionId,
        stampResult,
        sheetResults: safeSheetResults,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('log-redemption fatal error:', err)
    return new Response(
      JSON.stringify({ success: false, message: '서버 오류가 발생했습니다.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
