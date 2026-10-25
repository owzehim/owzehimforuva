import { supabase } from '../../../lib/supabase'

export async function fetchPendingReward(userId, restaurantId) {
  const { data, error } = await supabase
    .from('stamp_card_rewards')
    .select('id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .eq('redeemed', false)
    .is('expires_at', null)
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
  return data
}

// Admin use only — fetches all members with their stamp state for a given spot
export async function fetchAllMemberStampData(restaurantId, totalStamps) {
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
}
