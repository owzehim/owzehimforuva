import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession } from '../_shared/requireVerifiedLogin.ts'
import { recordAdminAction } from '../_shared/adminAudit.ts'

function computeStampState(totalVisits: number, totalStamps: number, pendingReward: any = null) {
  if (pendingReward) {
    const currentCycle = pendingReward.card_cycle ?? Math.floor(Math.max(totalVisits - 1, 0) / totalStamps) + 1
    return {
      totalVisits,
      currentCycle,
      stampsInCurrentCycle: totalStamps,
      isCardFull: true,
      hasPendingReward: true,
      pendingReward,
      currentCycleVisits: [],
    }
  }

  if (totalVisits === 0) {
    return {
      totalVisits: 0,
      currentCycle: 1,
      stampsInCurrentCycle: 0,
      isCardFull: false,
      hasPendingReward: false,
      pendingReward: null,
      currentCycleVisits: [],
    }
  }

  const remainder = totalVisits % totalStamps
  const currentCycle = Math.floor(totalVisits / totalStamps) + 1

  return {
    totalVisits,
    currentCycle,
    stampsInCurrentCycle: remainder,
    isCardFull: false,
    hasPendingReward: false,
    pendingReward: null,
    currentCycleVisits: [],
  }
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }

    const {
      action = 'addStamp',
      userId,
      restaurantId,
      rewardId,
      totalStamps,
      visitedAt,
      adminNote,
    } = await req.json().catch(() => ({}))

    const supportedActions = new Set(['addStamp', 'listMembers', 'restoreReward', 'resetProgress'])
    if (
      !supportedActions.has(action) ||
      ((action === 'addStamp' || action === 'listMembers' || action === 'resetProgress') && !restaurantId) ||
      (action === 'addStamp' && (!userId || !visitedAt)) ||
      (action === 'restoreReward' && !rewardId)
    ) {
      return json({ success: false, message: '잘못된 요청입니다.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = getSupabaseServiceKey()

    if (!serviceKey) {
      console.error('No service key found')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const caller = userData?.user

    if (userError || !caller) {
      console.error('Auth error:', userError)
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }
    if (!hasVerifiedAppLogin(token, caller.id)) {
      return json({ success: false, message: '이메일 인증을 포함해 다시 로그인해 주세요.' }, 403)
    }
    if (!(await hasActiveDeviceSession(admin, caller.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    const { data: adminRole, error: adminRoleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (adminRoleError) {
      console.error('Admin role lookup failed:', adminRoleError)
      return json({ success: false, message: '관리자 권한을 확인할 수 없습니다.' }, 500)
    }

    const isAdmin = Boolean(adminRole)

    if (!isAdmin) {
      return json({ success: false, message: '관리자 권한이 필요합니다.' }, 403)
    }

    if (action === 'restoreReward') {
      const { data: restoredReward, error: restoreError } = await admin
        .from('stamp_card_rewards')
        .update({ redeemed: false, redeemed_at: null })
        .eq('id', rewardId)
        .eq('redeemed', true)
        .is('expires_at', null)
        .select('id')
        .maybeSingle()

      if (restoreError) throw restoreError
      if (!restoredReward) {
        return json({ success: false, message: '이미 미사용 상태이거나 리워드를 찾을 수 없습니다.' }, 404)
      }

      const auditLogged = await recordAdminAction(admin, {
        actorId: caller.id,
        action: 'stamp_reward.restore',
        resourceType: 'stamp_card_rewards',
        resourceId: rewardId,
        changedFields: ['redeemed', 'redeemed_at'],
      })
      return json({ success: true, auditLogged })
    }

    if (action === 'resetProgress') {
      const { data: restaurant, error: restaurantError } = await admin
        .from('restaurants')
        .select('is_archived')
        .eq('id', restaurantId)
        .maybeSingle()

      if (restaurantError) throw restaurantError
      if (!restaurant || restaurant.is_archived) {
        return json({ success: false, message: '보관된 매장 기록은 변경할 수 없습니다.' }, 409)
      }

      const { error: rewardsError } = await admin
        .from('stamp_card_rewards')
        .delete()
        .eq('restaurant_id', restaurantId)

      if (rewardsError) throw rewardsError

      const { error: visitsError } = await admin
        .from('stamp_card_visits')
        .delete()
        .eq('restaurant_id', restaurantId)

      if (visitsError) throw visitsError

      const auditLogged = await recordAdminAction(admin, {
        actorId: caller.id,
        action: 'stamp_progress.reset',
        resourceType: 'restaurants',
        resourceId: restaurantId,
        changedFields: ['stamp_card_rewards', 'stamp_card_visits'],
      })
      return json({ success: true, auditLogged })
    }

    const safeTotalStamps = Math.max(1, Number(totalStamps || 10))

    if (action === 'listMembers') {
      const { data: memberSummaries, error: summariesError } = await admin.rpc(
        'admin_list_stamp_card_members',
        { p_restaurant_id: restaurantId },
      )

      if (summariesError) throw summariesError

      const rows = (Array.isArray(memberSummaries) ? memberSummaries : []).map(
        ({ member, visitCount, latestReward }: any) => {
          const pendingReward = latestReward?.redeemed === false &&
            (!latestReward.expires_at || Date.parse(latestReward.expires_at) > Date.now())
            ? latestReward
            : null

          return {
            member,
            stampState: computeStampState(Number(visitCount || 0), safeTotalStamps, pendingReward),
            latestReward,
          }
        },
      )

      return json({ success: true, rows })
    }

    const { data: targetMember, error: targetMemberError } = await admin
      .from('members')
      .select('id, user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (targetMemberError) throw targetMemberError
    if (!targetMember) {
      return json({ success: false, message: '멤버 계정과 연결된 사용자를 찾을 수 없습니다.' }, 404)
    }

    const { data: stampResultRows, error: stampError } = await admin.rpc(
      'admin_add_stamp_card_visit',
      {
        p_user_id: userId,
        p_restaurant_id: restaurantId,
        p_visited_at: visitedAt,
        p_admin_note: adminNote || null,
      },
    )
    if (stampError) throw stampError
    const stampResult = Array.isArray(stampResultRows) ? stampResultRows[0] : stampResultRows
    if (!stampResult) throw new Error('Stamp adjustment returned no result')

    const auditLogged = await recordAdminAction(admin, {
      actorId: caller.id,
      action: 'stamp.add',
      resourceType: 'members',
      resourceId: targetMember.id,
      changedFields: ['stamp_card_visits', 'stamp_card_rewards'],
    })

    if (stampResult.reward_pending) {
      return json({ success: true, auditLogged, rewardPending: true, cycleCompleted: true, cardCycle: stampResult.card_cycle })
    }

    return json({
      success: true,
      auditLogged,
      newCount: stampResult.new_count,
      cardCycle: stampResult.card_cycle,
      cycleCompleted: stampResult.cycle_completed,
    })
  } catch (err) {
    console.error('admin-add-stamp fatal error:', err)
    return json({
      success: false,
      message: '스탬프를 추가하지 못했습니다.',
    }, 500)
  }
})
