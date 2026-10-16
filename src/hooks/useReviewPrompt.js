// ─────────────────────────────────────────────────────────────
// useReviewPrompt
// Manages the full lifecycle of a review prompt:
//   1. On mount → check if a review prompt is due
//   2. If due  → open the modal automatically
//   3. On submit → save review, mark prompt submitted, close modal
//   4. On skip  → mark prompt dismissed, close modal
//
// Used in: MemberPage.jsx (mounted once when member home loads)
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import { getPendingReviewPrompt, markPromptSubmitted, markPromptDismissed } from '../api/reviewPromptApi'
import { createReview } from '../api/reviewApi'
import { refreshStoreReviewSummary } from './useStoreReviewSummary'
import { validateReviewInput } from '../domain/reviewDomain'
import { isProductionEnv } from '../lib/appEnv'

export function useReviewPrompt() {
  const [prompt, setPrompt]           = useState(null)
  const [open, setOpen]               = useState(false)
  const [rating, setRating]           = useState(null)
  const [tags, setTags]               = useState([])
  const [comment, setComment]         = useState('')
  const [loading, setLoading]         = useState(true)
  const [submitting, setSubmitting]   = useState(false)
  const [errors, setErrors]           = useState({})
  const [submitError, setSubmitError] = useState(null)

  const fetchedRef = useRef(false)

  // ── 1. On mount: check for a due prompt ──────────────────
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    async function checkForPrompt() {
      setLoading(true)

      // ⚠️ TEST MODE: fetch pending prompts and treat any pending one as due
      // by passing a now that is 50 min in the future.
      // To revert: remove the override and use getPendingReviewPrompt() as-is.
      const { data: allPending, error } = await getPendingReviewPrompt({
        testMode: !isProductionEnv,
      })

      if (!error && allPending) {
        setPrompt(allPending)
        setOpen(true)
      }
      setLoading(false)
    }

    // ⚠️ TEST MODE: show after 10 seconds instead of waiting for prompt_at
    // To revert: change to checkForPrompt()
    if (isProductionEnv) {
      checkForPrompt()
      const intervalId = setInterval(checkForPrompt, 60_000)
      return () => clearInterval(intervalId)
    }

    const timerId = setTimeout(checkForPrompt, 10_000)
    return () => clearTimeout(timerId)
  }, [])

  // ── 2. Tag toggle ─────────────────────────────────────────
  const toggleTag = useCallback((tagKey) => {
    setTags((prev) =>
      prev.includes(tagKey)
        ? prev.filter((t) => t !== tagKey)
        : [...prev, tagKey]
    )
    setErrors((prev) => ({ ...prev, tags: undefined }))
  }, [])

  // ── 3. Star rating ────────────────────────────────────────
  const selectRating = useCallback((value) => {
    setRating(value)
    setErrors((prev) => ({ ...prev, rating: undefined }))
  }, [])

  // ── 4. Close and reset ────────────────────────────────────
  const closeModal = useCallback(() => {
    setOpen(false)
    setTimeout(() => {
      setPrompt(null)
      setRating(null)
      setTags([])
      setComment('')
      setErrors({})
      setSubmitError(null)
    }, 350)
  }, [])

  // ── 5. Submit review ──────────────────────────────────────
  const submitReview = useCallback(async () => {
    if (!prompt) return

    const validation = validateReviewInput({ rating, tags })
    if (!validation.valid) {
      setErrors(validation.errors)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    const { error: reviewError } = await createReview({
      redemptionId: prompt.redemption_id,
      storeId:      prompt.store_id,
      rating,
      tags,
      comment:      comment.trim() || undefined,
    })

    if (reviewError) {
      setSubmitError('리뷰 저장에 실패했습니다. 다시 시도해주세요.')
      setSubmitting(false)
      return
    }

    try {
      const { error: summaryError } = await refreshStoreReviewSummary(prompt.store_id)
      if (summaryError) console.warn('Review summary refresh failed:', summaryError.message)
    } catch (err) {
      console.warn('Review summary refresh failed:', err?.message)
    }

    await markPromptSubmitted(prompt.id)
    setSubmitting(false)
    closeModal()
  }, [prompt, rating, tags, comment, closeModal])

  // ── 6. Skip / dismiss ─────────────────────────────────────
  const skipReview = useCallback(async () => {
    if (!prompt) return
    markPromptDismissed(prompt.id).catch((err) =>
      console.warn('markPromptDismissed failed:', err?.message)
    )
    closeModal()
  }, [prompt, closeModal])

  const storeName = prompt?.partnerships?.name ?? prompt?.store_id ?? '매장'

  return {
    loading,
    open,
    prompt,
    storeName,
    rating,
    tags,
    comment,
    errors,
    submitError,
    submitting,
    selectRating,
    toggleTag,
    setComment,
    submitReview,
    skipReview,
  }
}
