// ─────────────────────────────────────────────────────────────
// REVIEW PROMPT API
// Supabase calls for managing review_prompts.
// No React, no UI logic, no domain rules — just data access.
// ─────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'
import { shouldShowReviewPrompt } from '../domain/reviewDomain'

// ─────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────

/**
 * Fetches the next review prompt that is due for a user.
 *
 * @param {{ userId: string, testMode?: boolean }} options
 *   testMode: if true, pretends it's 50 min in the future so any
 *   pending prompt is immediately considered due. Remove for production.
 *
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getPendingReviewPrompt({ userId, testMode = false } = {}) {
  if (!userId) return { data: null, error: { message: '로그인이 필요합니다.' } }

  const { data, error } = await supabase
    .from('review_prompts')
    .select(`
      id,
      redemption_id,
      store_id,
      prompt_at,
      status,
      partnerships ( name )
    `)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('prompt_at', { ascending: true })

  if (error) {
    console.error('getPendingReviewPrompt error:', error)
    return { data: null, error }
  }

  if (!data || data.length === 0) return { data: null, error: null }

  // ⚠️ TEST MODE: shift now 50 min forward so any pending prompt is due
  // To revert: change to `const now = new Date()`
  const now = testMode
    ? new Date(new Date().getTime() + 50 * 60 * 1000)
    : new Date()

  const duePrompt = data.find((p) => shouldShowReviewPrompt(p, now))

  return { data: duePrompt ?? null, error: null }
}

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * Marks a review prompt as submitted.
 * Called after a review is successfully saved.
 *
 * @param {string} promptId - UUID of the review_prompt row
 * @returns {Promise<{ error: object|null }>}
 */
export async function markPromptSubmitted(promptId) {
  const { error } = await supabase
    .from('review_prompts')
    .update({ status: 'submitted' })
    .eq('id', promptId)

  if (error) console.error('markPromptSubmitted error:', error)
  return { error: error ?? null }
}

/**
 * Marks a review prompt as dismissed.
 * Called when the user closes the modal without submitting.
 *
 * @param {string} promptId - UUID of the review_prompt row
 * @returns {Promise<{ error: object|null }>}
 */
export async function markPromptDismissed(promptId) {
  const { error } = await supabase
    .from('review_prompts')
    .update({ status: 'dismissed' })
    .eq('id', promptId)

  if (error) console.error('markPromptDismissed error:', error)
  return { error: error ?? null }
}
