import { supabase } from '../../../lib/supabase'
import { computeCycle, checkAlreadyStampedToday } from '../utils'
import { fetchPendingReward } from './rewards'

export async function fetchVisits(userId, restaurantId) {
  const { data, error } = await supabase
    .from('stamp_card_visits')
    .select('id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .order('visited_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function resetStampCardProgress(restaurantId) {
  const { error: rewardsError } = await supabase
    .from('stamp_card_rewards')
    .delete()
    .eq('restaurant_id', restaurantId)

  if (rewardsError) throw rewardsError

  const { error: visitsError } = await supabase
    .from('stamp_card_visits')
    .delete()
    .eq('restaurant_id', restaurantId)

  if (visitsError) throw visitsError
}

export async function insertVisit(userId, restaurantId, totalStamps) {
  const pendingReward = await fetchPendingReward(userId, restaurantId)
  if (pendingReward) {
    return {
      rewardPending: true,
      cycleCompleted: true,
      cardCycle: pendingReward.card_cycle,
    }
  }

  const alreadyStamped = await checkAlreadyStampedToday(userId, restaurantId)
  if (alreadyStamped) return { alreadyStamped: true }

  const priorVisits = await fetchVisits(userId, restaurantId)
  const priorCount = priorVisits.length
  const cardCycle = computeCycle(priorCount, totalStamps)

  const { error: insertError } = await supabase
    .from('stamp_card_visits')
    .insert({
      user_id: userId,
      restaurant_id: restaurantId,
      visited_at: new Date().toISOString(),
      card_cycle: cardCycle,
      added_by_admin: false,
    })

  if (insertError) throw insertError

  const newCount = priorCount + 1
  const cycleCompleted = newCount % totalStamps === 0

  if (cycleCompleted) {
    const { error: rewardError } = await supabase
      .from('stamp_card_rewards')
      .insert({
        user_id: userId,
        restaurant_id: restaurantId,
        card_cycle: cardCycle,
        redeemed: false,
      })

    if (rewardError) throw rewardError
  }

  return { alreadyStamped: false, success: true, newCount, cardCycle, cycleCompleted }
}

export async function adminInsertVisit(userId, restaurantId, totalStamps, visitedAt, adminNote) {
  const { data, error } = await supabase.functions.invoke('admin-add-stamp', {
    body: {
      userId,
      restaurantId,
      totalStamps,
      visitedAt,
      adminNote,
    },
  })

  if (error) throw new Error(data?.message || error.message || '스탬프 추가에 실패했습니다.')
  if (!data?.success) throw new Error(data?.message || '스탬프 추가에 실패했습니다.')

  return data
}
