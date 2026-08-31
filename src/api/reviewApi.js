// ─────────────────────────────────────────────────────────────
// REVIEW API
// All Supabase calls related to reviews.
// No React, no UI logic, no domain rules — just data access.
// ─────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'
import { buildReviewSummary } from '../domain/reviewDomain'

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
  syncReviewToSheets({ redemptionId, storeId, rating, tags, comment, userId: user.id })
    .catch((err) => console.warn('Sheet sync failed (non-critical):', err?.message))

  if (comment?.trim()) {
    syncReviewCommentToRestaurantNotes({
      reviewId: data.id,
      redemptionId,
      storeId,
      rating,
      tags,
      comment,
      userId: user.id,
    }).catch((err) => console.warn('Review note sync failed (non-critical):', err?.message))
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
 * Fetches the review summary for a store (average rating, count, tag counts).
 *
 * @param {string} storeId
 * @returns {Promise<{
 *   data: { store_id: string, average_rating: number, review_count: number, tag_counts: object }|null,
 *   error: object|null
 * }>}
 */
export async function getStoreReviewSummary(storeId) {
  const { data, error } = await getStoreReviewSummaries([storeId])
  return { data: data?.[0] ?? null, error }
}

/**
 * Fetches summaries for multiple stores in one request so rating data can be
 * ready before a SpotCard is opened.
 *
 * @param {string[]} storeIds
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
export async function getStoreReviewSummaries(storeIds) {
  const uniqueStoreIds = Array.from(new Set((storeIds || []).filter(Boolean)))
  if (uniqueStoreIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase.rpc('get_store_review_summaries', {
    p_store_ids: uniqueStoreIds,
  })

  if (error) {
    console.warn(
      'get_store_review_summaries RPC unavailable; using client aggregation fallback:',
      error.message,
    )

    const { data: reviews, error: fallbackError } = await supabase
      .from('reviews')
      .select('store_id, rating, tags')
      .in('store_id', uniqueStoreIds)

    if (fallbackError) return { data: null, error: fallbackError }

    const reviewsByStore = new Map(
      uniqueStoreIds.map((storeId) => [storeId, []]),
    )
    for (const review of reviews || []) {
      reviewsByStore.get(review.store_id)?.push(review)
    }

    return {
      data: uniqueStoreIds.map((storeId) =>
        buildReviewSummary(storeId, reviewsByStore.get(storeId)),
      ),
      error: null,
    }
  }

  return { data: data || [], error: null }
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
 *   comment?: string,
 *   userId: string
 * }} params
 */
async function syncReviewToSheets({ redemptionId, storeId, rating, tags, comment, userId }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.functions.invoke('sync-to-sheets', {
    body: {
      redemption_id: redemptionId,
      store_id:      storeId,
      user_id:       userId,
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
    .maybeSingle()

  if (restaurantError || !restaurant?.id) {
    throw restaurantError || new Error('Matching restaurant not found')
  }

  const { data: member } = await supabase
    .from('members')
    .select('username, first_name, last_name, first_name_korean, last_name_korean')
    .eq('user_id', userId)
    .maybeSingle()

  const noteUsername = (
    member?.username ||
    [member?.last_name_korean, member?.first_name_korean].filter(Boolean).join('') ||
    [member?.first_name, member?.last_name].filter(Boolean).join(' ')
  ).trim()

  const { error } = await supabase
    .from('restaurant_notes')
    .insert({
      restaurant_id: restaurant.id,
      user_id: userId,
      username: noteUsername,
      body: trimmedComment,
      is_anonymous: false,
      source_review_id: reviewId,
      source_redemption_id: redemptionId,
      source_store_id: storeId,
      source_rating: rating,
      source_tags: tags,
    })

  if (error) throw error
}
