import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { sheetText } from '../_shared/sheetText.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'

async function syncClaimToAppsScript(
  url: string | null | undefined,
  label: string,
  payload: Record<string, unknown>,
) {
  if (!url) {
    console.warn(`Skipping ${label} reward claim sync: missing Apps Script URL`)
    return { ok: false, skipped: true }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withAppsScriptSecret(payload, Deno.env.get('APPS_SCRIPT_SHARED_SECRET'))),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      // Avoid logging an external response that might contain submitted data.
      console.error(`${label} reward claim sync failed:`, response.status)
      return { ok: false, status: response.status }
    }

    try {
      const result = text ? JSON.parse(text) : null
      if (result && typeof result === 'object' && result.success === false) {
        console.error(`${label} Apps Script returned failure`)
        return { ok: false }
      }
    } catch {
      // Apps Script may return plain text when the request succeeds.
    }

    return { ok: true }
  } catch (error) {
    console.error(`${label} reward claim sync threw:`, error)
    return { ok: false }
  }
}

serve(async (req) => {
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
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rewardId) ||
      (typeof redemptionId !== 'string' && typeof redemptionId !== 'number') ||
      !/^[1-9]\d{0,17}$/.test(String(redemptionId)) ||
      typeof storeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)
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

    const { data: reward, error: rewardError } = await admin
      .from('stamp_card_rewards')
      .select('id, restaurant_id, redeemed')
      .eq('id', rewardId)
      .eq('user_id', user.id)
      .eq('redeemed', false)
      .maybeSingle()

    if (rewardError) {
      console.error('Reward lookup failed:', rewardError)
      return json({ success: false, message: '리워드 상태를 확인하지 못했습니다.' }, 500)
    }
    if (!reward) return json({ success: false, message: '사용 가능 리워드를 찾을 수 없습니다.' }, 404)

    // A reward can only be consumed in the context of a recent server-recorded
    // check-in by this same member at the same store.
    const recentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: redemption, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, store_id, redeemed_at')
      .eq('id', String(redemptionId))
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .gte('redeemed_at', recentCutoff)
      .lte('redeemed_at', new Date().toISOString())
      .maybeSingle()

    if (redemptionError) {
      console.error('Check-in validation failed:', redemptionError)
      return json({ success: false, message: '최근 매장 방문을 확인하지 못했습니다.' }, 500)
    }
    if (!redemption) return json({ success: false, message: '최근 매장 체크인을 확인할 수 없습니다.' }, 403)

    const { data: restaurantById, error: restaurantLookupError } = await admin
      .from('restaurants')
      .select('id')
      .eq('id', storeId)
      .maybeSingle()

    if (restaurantLookupError) {
      console.error('Restaurant lookup failed:', restaurantLookupError)
      return json({ success: false, message: '매장 정보를 확인하지 못했습니다.' }, 500)
    }

    let restaurantId = restaurantById?.id ?? null
    if (!restaurantId) {
      const { data: restaurantByPartnership, error: partnershipLookupError } = await admin
        .from('restaurants')
        .select('id')
        .eq('partnership_id', storeId)
        .maybeSingle()

      if (partnershipLookupError) {
        console.error('Partner restaurant lookup failed:', partnershipLookupError)
        return json({ success: false, message: '매장 정보를 확인하지 못했습니다.' }, 500)
      }
      restaurantId = restaurantByPartnership?.id ?? null
    }

    if (!restaurantId || restaurantId !== reward.restaurant_id) {
      return json({ success: false, message: '이 매장에서 사용할 수 있는 리워드가 아닙니다.' }, 403)
    }

    // The redeemed=false predicate makes this a one-way, atomic state change:
    // concurrent or repeated claims can update the reward only once.
    const { data: updatedReward, error: updateError } = await admin
      .from('stamp_card_rewards')
      .update({ redeemed: true, redeemed_at: new Date().toISOString() })
      .eq('id', rewardId)
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .eq('redeemed', false)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Reward update failed:', updateError)
      return json({ success: false, message: '리워드 사용 처리에 실패했습니다.' }, 500)
    }
    if (!updatedReward) {
      return json({ success: false, message: '이 리워드는 이미 사용되었습니다.' }, 409)
    }

    const { data: partnership, error: partnershipError } = await admin
      .from('partnerships')
      .select('name, sheet_name')
      .eq('id', storeId)
      .maybeSingle()

    if (partnershipError || !partnership) {
      console.error('Reward claim partnership lookup failed:', partnershipError)
      return json({ success: true, sheetSync: { success: false } })
    }

    const { data: integrations, error: integrationsError } = await admin
      .from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', storeId)
      .maybeSingle()

    if (integrationsError) {
      console.error('Reward claim integration lookup failed:', integrationsError)
      return json({ success: true, sheetSync: { success: false } })
    }

    const claimPayload = {
      type: 'stamp_claim',
      partnership_id: storeId,
      sheet_name: sheetText(partnership.sheet_name || partnership.name, 160),
      redemption_id: String(redemption.id),
      stamp_status: 'claimed',
    }
    const sheetResults = await Promise.all([
      syncClaimToAppsScript(integrations?.master_apps_script_url, 'master', claimPayload),
      syncClaimToAppsScript(integrations?.partner_apps_script_url, 'partner', claimPayload),
    ])

    return json({
      success: true,
      sheetSync: { success: sheetResults.every((result) => result.ok) },
    })
  } catch (error) {
    console.error('Unexpected reward redemption error:', error)
    return json({ success: false, message: '리워드 사용 처리에 실패했습니다.' }, 500)
  }
})
