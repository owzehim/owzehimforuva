import { supabase } from '../../../lib/supabase'

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
  const { data, error } = await supabase.functions.invoke('admin-add-stamp', {
    body: { action: 'resetProgress', restaurantId },
  })

  if (error) throw new Error(data?.message || error.message || '스탬프 기록 초기화에 실패했습니다.')
  if (!data?.success) throw new Error(data?.message || '스탬프 기록 초기화에 실패했습니다.')
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
