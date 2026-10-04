import { supabase } from '../../../lib/supabase'
import { computeStampState } from '../utils'

export async function fetchPendingReward(userId, restaurantId) {
  const { data, error } = await supabase
    .from('stamp_card_rewards')
    .select('id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .eq('redeemed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }
  return data
}

export async function redeemReward(rewardId, sheetSync = {}) {
  const { data, error } = await supabase.functions.invoke('redeem-stamp-card-reward', {
    body: {
      rewardId,
      redemptionId: sheetSync.redemptionId,
      storeId: sheetSync.storeId,
    },
  })

  if (error) throw new Error(data?.message || error.message || '리워드 사용 처리에 실패했습니다.')
  if (!data?.success) throw new Error(data?.message || '리워드 사용 처리에 실패했습니다.')

  return data
}

export async function restoreReward(rewardId) {
  const { data, error } = await supabase.functions.invoke('admin-add-stamp', {
    body: { action: 'restoreReward', rewardId },
  })

  if (error) throw new Error(data?.message || error.message || '리워드 복원에 실패했습니다.')
  if (!data?.success) throw new Error(data?.message || '리워드 복원에 실패했습니다.')
}

// Admin use only — fetches all members with their stamp state for a given spot
export async function fetchAllMemberStampData(restaurantId, totalStamps) {
  try {
    const { data, error } = await supabase.functions.invoke('admin-add-stamp', {
      body: {
        action: 'listMembers',
        restaurantId,
        totalStamps,
      },
    })

    if (error) throw new Error(data?.message || error.message || '스탬프 정보를 불러오지 못했습니다.')
    if (!data?.success) throw new Error(data?.message || '스탬프 정보를 불러오지 못했습니다.')

    return data.rows ?? []
  } catch (error) {
    console.warn('admin-add-stamp listMembers unavailable; falling back to client queries:', error)
    return fetchAllMemberStampDataFallback(restaurantId, totalStamps)
  }
}

async function fetchAllMemberStampDataFallback(restaurantId, totalStamps) {
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, user_id, first_name, last_name')
    .not('user_id', 'is', null)

  if (membersError) throw membersError
  if (!members?.length) return []

  const results = await Promise.all(
    members.map(async (member) => {
      const { data: visits, error: visitsError } = await supabase
        .from('stamp_card_visits')
        .select('id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note')
        .eq('user_id', member.user_id)
        .eq('restaurant_id', restaurantId)
        .order('visited_at', { ascending: true })

      if (visitsError) throw visitsError

      const { data: latestRewardRows, error: rewardsError } = await supabase
        .from('stamp_card_rewards')
        .select('id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at')
        .eq('user_id', member.user_id)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (rewardsError) throw rewardsError

      const latestReward = latestRewardRows?.[0] ?? null
      const pendingReward = latestReward?.redeemed === false ? latestReward : null
      const stampState = computeStampState(visits ?? [], totalStamps, pendingReward)

      return { member, stampState, latestReward }
    }),
  )

  return results
}
