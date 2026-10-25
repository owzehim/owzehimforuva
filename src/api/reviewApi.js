// ─────────────────────────────────────────────────────────────
// REVIEW API
// All Supabase calls related to reviews.
// No React, no UI logic, no domain rules — just data access.
// ─────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────

/**
 * Inserts a new review into Supabase.
 * Also triggers the Google Sheets row update via Edge Function.
 *
 * @param {{
 *   redemptionId: number,
 *   storeId: string,
 *   rating: number,
 *   tags: string[],
 *   comment?: string
 * }} params
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function createReview({ redemptionId, storeId, rating, tags, comment }) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { data: null, error: { message: '로그인이 필요합니다.' } }
  }

  const { data: restaurantStatus, error: restaurantStatusError } = await supabase
    .from('restaurants')
    .select('id, is_archived')
    .eq('partnership_id', storeId)
    .maybeSingle()

  if (restaurantStatusError) return { data: null, error: restaurantStatusError }
  if (restaurantStatus?.is_archived) {
    return { data: null, error: { message: '제휴 종료된 매장에는 리뷰를 작성할 수 없습니다.' } }
  }

  // 1. Insert review into Supabase
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      redemption_id: redemptionId,
      user_id:       user.id,
      store_id:      storeId,
      rating,
      tags,
      comment:       comment || null,
    })
    .select()
    .single()

  if (error) {
    console.error('createReview error:', error)
    return { data: null, error }
  }

  // 2. Trigger Google Sheets update via Edge Function (fire and forget)
  // We don't await this — if it fails, the review is still saved in Supabase
  syncReviewToSheets({ redemptionId, storeId, rating, tags, comment })
    .catch((err) => console.warn('Sheet sync failed (non-critical):', err?.message))

  if (comment?.trim()) {
    try {
      await syncReviewCommentToRestaurantNotes({
        reviewId: data.id,
        redemptionId,
        storeId,
        rating,
        tags,
        comment,
        userId: user.id,
      })
    } catch (err) {
      console.warn('Review note sync failed (non-critical):', err?.message)
    }
  }

  return { data, error: null }
}

// ─────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────

/**
 * Fetches all reviews for a given store.
 * Used to compute the review summary shown on SpotCard.
 *
 * @param {string} storeId
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
export async function getReviewsByStore(storeId) {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, tags, comment, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('getReviewsByStore error:', error)
    return { data: null, error }
  }

  return { data, error: null }
}

/**
 * Fetches location aggregates for public and active-member map screens.
 * Individual member notes are shown only to active members.
 *
 * @param {string} storeId
 * @returns {Promise<{
 *   data: { store_id: string, average_rating: number, review_count: number, tag_counts: object }|null,
 *   error: object|null
 * }>}
 */
export async function getStoreReviewSummary(storeId, audience = 'public') {
  const { data, error } = await getStoreReviewSummaries([storeId], audience)
  return { data: data?.[0] ?? null, error }
}

/**
 * Fetches summaries for multiple stores in one request so rating data can be
 * ready before a SpotCard is opened.
 *
 * @param {string[]} storeIds
 * @param {'member'|'public'} [audience='public']
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
export async function getStoreReviewSummaries(storeIds, audience = 'public') {
  const uniqueStoreIds = Array.from(new Set((storeIds || []).filter(Boolean)))
  if (uniqueStoreIds.length === 0) return { data: [], error: null }

  const batches = []
  for (let index = 0; index < uniqueStoreIds.length; index += 100) {
    batches.push(uniqueStoreIds.slice(index, index + 100))
  }

  const results = await Promise.all(
    batches.map((batch) =>
      supabase.rpc(
        audience === 'member'
          ? 'get_member_store_review_summaries'
          : 'get_store_review_summaries',
        { p_store_ids: batch },
      ),
    ),
  )
  const error = results.find((result) => result.error)?.error
  if (error) return { data: null, error }

  return { data: results.flatMap((result) => result.data || []), error: null }
}

/**
 * Checks if the current user has already reviewed a specific redemption.
 * Used to guard against duplicate reviews.
 *
 * @param {number} redemptionId
 * @returns {Promise<boolean>}
 */
export async function hasUserReviewedRedemption(redemptionId) {
  const { data, error } = await supabase
    .from('reviews')
    .select('id')
    .eq('redemption_id', redemptionId)
    .maybeSingle()

  if (error) {
    console.error('hasUserReviewedRedemption error:', error)
    return false
  }

  return data !== null
}

// ─────────────────────────────────────────────────────────────
// GOOGLE SHEETS SYNC (internal — not exported directly)
// Calls the existing Edge Function to update the scan row
// in both master and partner sheets with review data.
// ─────────────────────────────────────────────────────────────

/**
 * @param {{
 *   redemptionId: number,
 *   storeId: string,
 *   rating: number,
 *   tags: string[],
 *   comment?: string
 * }} params
 */
async function syncReviewToSheets({ redemptionId, storeId, rating, tags, comment }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.functions.invoke('sync-to-sheets', {
    body: {
      redemption_id: redemptionId,
      store_id:      storeId,
      rating,
      tags,          // ← raw array e.g. ['GREAT_FOOD', 'GOOD_VALUE']
      comment:       comment || '',
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  })
}

async function syncReviewCommentToRestaurantNotes({
  reviewId,
  redemptionId,
  storeId,
  rating,
  tags,
  comment,
  userId,
}) {
  const trimmedComment = comment?.trim()
  if (!trimmedComment) return

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id')
    .eq('partnership_id', storeId)
    .eq('is_archived', false)
    .maybeSingle()

  if (restaurantError || !restaurant?.id) {
    throw restaurantError || new Error('Matching restaurant not found')
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('username')
    .eq('user_id', userId)
    .maybeSingle()

  if (memberError) throw memberError
  const username = member?.username?.trim() || ''
  const { data: existingNote, error: lookupError } = await supabase
    .from('restaurant_notes_safe')
    .select('id')
    .eq('source_redemption_id', redemptionId)
    .eq('is_mine', true)
    .maybeSingle()

  if (lookupError) throw lookupError

  const notePayload = {
    body: trimmedComment,
    is_anonymous: !username,
    username: username || '익명',
  }
  const result = existingNote
    ? await supabase.from('restaurant_notes').update(notePayload).eq('id', existingNote.id)
    : await supabase.from('restaurant_notes').insert({
        ...notePayload,
        restaurant_id: restaurant.id,
        user_id: userId,
        source_review_id: reviewId,
        source_redemption_id: redemptionId,
        source_store_id: storeId,
        source_rating: rating,
        source_tags: tags,
      })

  if (result.error) throw result.error
}
