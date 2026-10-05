import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.ts'

const STAMP_DAY_TIME_ZONE = 'Europe/Amsterdam'

function getDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return Object.fromEntries(parts.map(({ type, value }) => [type, value])) as Record<string, string>
}

function getLocalDateKey(date: Date, timeZone: string) {
  const parts = getDateParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function getLocalMidnightUtc(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcMidnightGuess = Date.UTC(year, month - 1, day)
  const localPartsAtGuess = getDateParts(new Date(utcMidnightGuess), timeZone)
  const localTimeAsUtc = Date.UTC(
    Number(localPartsAtGuess.year),
    Number(localPartsAtGuess.month) - 1,
    Number(localPartsAtGuess.day),
    Number(localPartsAtGuess.hour),
    Number(localPartsAtGuess.minute),
    Number(localPartsAtGuess.second),
  )
  const offsetAtGuess = localTimeAsUtc - utcMidnightGuess
  return new Date(utcMidnightGuess - offsetAtGuess)
}

function getLocalDayUtcRange(date: Date, timeZone: string) {
  const dateKey = getLocalDateKey(date, timeZone)
  const [year, month, day] = dateKey.split('-').map(Number)
  const nextDateKey = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)

  return {
    start: getLocalMidnightUtc(dateKey, timeZone).toISOString(),
    endExclusive: getLocalMidnightUtc(nextDateKey, timeZone).toISOString(),
  }
}

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
      // Apps Script sometimes returns plain text on deployment/configuration errors.
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

async function ensureCompletedCycleReward(
  admin: any,
  userId: string,
  restaurantId: string,
  cardCycle: number | null,
  totalStamps: number,
) {
  if (cardCycle == null) return false

  const { data: existingReward, error: existingRewardError } = await admin
    .from('stamp_card_rewards')
    .select('id, redeemed')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .eq('card_cycle', cardCycle)
    .maybeSingle()

  if (existingRewardError) throw existingRewardError
  if (existingReward) return existingReward.redeemed === false

  const { data: cycleVisits, error: cycleVisitsError } = await admin
    .from('stamp_card_visits')
    .select('id')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .eq('card_cycle', cardCycle)

  if (cycleVisitsError) throw cycleVisitsError
  if ((cycleVisits?.length ?? 0) < totalStamps) return false

  const { error: rewardError } = await admin
    .from('stamp_card_rewards')
    .insert({
      user_id: userId,
      restaurant_id: restaurantId,
      card_cycle: cardCycle,
      redeemed: false,
    })

  if (rewardError?.code === '23505') {
    // A concurrent request may have created the same cycle's reward.
    const { data: concurrentReward, error: concurrentRewardError } = await admin
      .from('stamp_card_rewards')
      .select('id, redeemed')
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId)
      .eq('card_cycle', cardCycle)
      .maybeSingle()

    if (concurrentRewardError) throw concurrentRewardError
    return concurrentReward?.redeemed === false
  }
  if (rewardError) throw rewardError
  return true
}

async function recordStampCardVisit(admin: any, userId: string, storeId: string, now: Date) {
  const restaurant = await findStampRestaurant(admin, storeId)
  if (!restaurant?.stamp_card_enabled) return { enabled: false }

  const restaurantId = restaurant.id

  const { data: config, error: configError } = await admin
    .from('stamp_card_config')
    .select('total_stamps')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()

  if (configError) console.error('Stamp config fetch error:', configError)

  const totalStamps = Math.max(1, Number(config?.total_stamps || 10))
  const localDay = getLocalDayUtcRange(now, STAMP_DAY_TIME_ZONE)

  const { data: pendingReward, error: pendingRewardError } = await admin
    .from('stamp_card_rewards')
    .select('*')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .eq('redeemed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingRewardError) throw pendingRewardError

  if (pendingReward) {
    return {
      enabled: true,
      restaurantId,
      rewardPending: true,
      cycleCompleted: true,
      cardCycle: pendingReward.card_cycle,
      totalStamps,
    }
  }

  const { data: todayVisit, error: todayVisitError } = await admin
    .from('stamp_card_visits')
    .select('id, card_cycle')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .gte('visited_at', localDay.start)
    .lt('visited_at', localDay.endExclusive)
    .limit(1)
    .maybeSingle()

  if (todayVisitError) throw todayVisitError

  if (todayVisit) {
    const rewardPending = await ensureCompletedCycleReward(
      admin,
      userId,
      restaurantId,
      todayVisit.card_cycle,
      totalStamps,
    )

    if (rewardPending) {
      return {
        enabled: true,
        restaurantId,
        rewardPending: true,
        cycleCompleted: true,
        cardCycle: todayVisit.card_cycle,
        totalStamps,
      }
    }

    const { data: currentVisits, error: currentVisitsError } = await admin
      .from('stamp_card_visits')
      .select('id')
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId)

    if (currentVisitsError) throw currentVisitsError

    const currentCount = (currentVisits?.length ?? 0) % totalStamps
    return { enabled: true, restaurantId, alreadyStamped: true, currentCount, totalStamps }
  }

  const { data: priorVisits, error: priorVisitsError } = await admin
    .from('stamp_card_visits')
    .select('id')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)

  if (priorVisitsError) throw priorVisitsError

  const priorCount = priorVisits?.length ?? 0
  const cardCycle = Math.floor(priorCount / totalStamps) + 1

  const { error: insertError } = await admin
    .from('stamp_card_visits')
    .insert({
      user_id: userId,
      restaurant_id: restaurantId,
      visited_at: now.toISOString(),
      card_cycle: cardCycle,
      added_by_admin: false,
    })

  if (insertError?.code === '23505') {
    // A unique daily-visit index closes the race between concurrent scans.
    const { data: duplicateVisit, error: duplicateCheckError } = await admin
      .from('stamp_card_visits')
      .select('id, card_cycle')
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId)
      .gte('visited_at', localDay.start)
      .lt('visited_at', localDay.endExclusive)
      .limit(1)
      .maybeSingle()

    if (duplicateCheckError) throw duplicateCheckError
    if (duplicateVisit) {
      const rewardPending = await ensureCompletedCycleReward(
        admin,
        userId,
        restaurantId,
        duplicateVisit.card_cycle,
        totalStamps,
      )

      if (rewardPending) {
        return {
          enabled: true,
          restaurantId,
          rewardPending: true,
          cycleCompleted: true,
          cardCycle: duplicateVisit.card_cycle,
          totalStamps,
        }
      }

      return {
        enabled: true,
        restaurantId,
        alreadyStamped: true,
        currentCount: (priorCount + 1) % totalStamps,
        totalStamps,
      }
    }

    throw insertError
  }

  const newCount = priorCount + 1
  const cycleCompleted = newCount % totalStamps === 0

  if (cycleCompleted) {
    const { error: rewardError } = await admin
      .from('stamp_card_rewards')
      .insert({
        user_id: userId,
        restaurant_id: restaurantId,
        card_cycle: cardCycle,
        redeemed: false,
      })

    if (rewardError && rewardError.code !== '23505') throw rewardError
  }

  return {
    enabled: true,
    restaurantId,
    alreadyStamped: false,
    success: true,
    newCount,
    cardCycle,
    cycleCompleted,
    totalStamps,
  }
}

serve(async (req) => {
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
    const validUntil = member.membership_valid_until
      ? new Date(member.membership_valid_until)
      : null

    if (!member.is_member) {
      return new Response(
        JSON.stringify({ success: false, message: '멤버십이 활성화되어 있지 않습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!validUntil || validUntil < now) {
      return new Response(
        JSON.stringify({ success: false, message: '멤버십이 만료되었습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch partnership ──────────────────────────────────────────────────
    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name, master_apps_script_url, partner_apps_script_url')
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
    const safe = (v: unknown) => (v != null && v !== '' ? String(v) : '')

    // Record (or safely recognize) today's visit before claiming the 15-minute
    // redemption window. If stamp persistence fails, return an error without
    // consuming the retry window; the unique daily index handles scan races.
    let stampResult
    try {
      stampResult = await recordStampCardVisit(admin, user.id, storeId, now)
    } catch (stampError) {
      console.error('Stamp card record error:', stampError)
      return new Response(
        JSON.stringify({ success: false, message: '스탬프 기록을 처리하지 못했습니다. 다시 시도해 주세요.' }),
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
  place_name: partnership.name,

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
      sheet_name: partnership.sheet_name || partnership.name,
      date,
      time,
      redemption_id: redemptionId,
      place_name: partnership.name,
      stamp_status: formatStampStatus(stampResult),
      stamp_progress: formatStampProgress(stampResult),
      stamp_card_progress: formatStampProgress(stampResult),
      stamp_card_claimed_after_scan: stampResult?.claimedAfterScan ? 'Yes' : 'No',
    }

    const sheetResults = await Promise.all([
      postJsonToAppsScript(partnership.master_apps_script_url, masterPayload, 'master'),
      postJsonToAppsScript(partnership.partner_apps_script_url, storePayload, 'partner'),
    ])

    return new Response(
      JSON.stringify({
        success: true,
        storeName: partnership.name,
        redemptionId,
        stampResult,
        sheetResults,
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
