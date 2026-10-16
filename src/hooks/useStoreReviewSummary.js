// ─────────────────────────────────────────────────────────────
// useStoreReviewSummary
// Fetches and returns the review summary for a single store.
// Used by SpotCard to display:
//   - Average star rating + count  (section 1: place info)
//   - Tag breakdown                (section 3: multiple choice results)
//
// Only fetches when a store is actually selected (storeId truthy).
// Re-fetches automatically when a different store is selected.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { getStoreReviewSummaries, getStoreReviewSummary } from '../api/reviewApi'

const summaryCache = new Map()
const summaryListeners = new Map()

function getCacheKey(storeId, audience) {
  return `${audience}:${storeId}`
}

function notifyStoreReviewSummary(storeId, audience) {
  const listeners = summaryListeners.get(getCacheKey(storeId, audience)) || []
  for (const listener of listeners) listener()
}

function subscribeToStoreReviewSummary(storeId, audience, listener) {
  const cacheKey = getCacheKey(storeId, audience)
  if (!summaryListeners.has(cacheKey)) summaryListeners.set(cacheKey, new Set())
  const listeners = summaryListeners.get(cacheKey)
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) summaryListeners.delete(cacheKey)
  }
}

export async function primeStoreReviewSummaries(storeIds, audience = 'public') {
  const missingStoreIds = Array.from(
    new Set((storeIds || []).filter((storeId) =>
      storeId && !summaryCache.has(getCacheKey(storeId, audience)))),
  )
  if (missingStoreIds.length === 0) return

  const { data } = await getStoreReviewSummaries(missingStoreIds, audience)
  for (const summary of data || []) {
    summaryCache.set(getCacheKey(summary.store_id, audience), summary)
    notifyStoreReviewSummary(summary.store_id, audience)
  }
}

export async function refreshStoreReviewSummary(storeId, audience = 'member') {
  if (!storeId) return { error: null }

  const { data, error } = await getStoreReviewSummary(storeId, audience)
  if (error) return { error }

  const cacheKey = getCacheKey(storeId, audience)
  if (data) summaryCache.set(cacheKey, data)
  else summaryCache.delete(cacheKey)
  notifyStoreReviewSummary(storeId, audience)

  return { error: null }
}

export function useStoreReviewSummary(storeId, audience = 'public') {
  const [, setRevision] = useState(0)
  const cacheKey = storeId ? getCacheKey(storeId, audience) : null
  const hasCachedSummary = Boolean(cacheKey && summaryCache.has(cacheKey))
  const cachedSummary = hasCachedSummary ? summaryCache.get(cacheKey) : null
  const [state, setState] = useState({
    storeId: null,
    audience: null,
    summary: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!storeId) return undefined
    return subscribeToStoreReviewSummary(storeId, audience, () => {
      setRevision((revision) => revision + 1)
    })
  }, [storeId, audience])

  useEffect(() => {
    if (!storeId || summaryCache.has(getCacheKey(storeId, audience))) return undefined

    let cancelled = false

    async function fetchSummary() {
      const { data, error: fetchError } = await getStoreReviewSummary(storeId, audience)

      if (cancelled) return

      if (fetchError) {
        setState({
          storeId,
          audience,
          summary: null,
          loading: false,
          error: fetchError.message ?? '리뷰를 불러오지 못했습니다.',
        })
      } else {
        summaryCache.set(getCacheKey(storeId, audience), data)
        notifyStoreReviewSummary(storeId, audience)
        setState({ storeId, audience, summary: data, loading: false, error: null })
      }
    }

    void fetchSummary()

    // Cleanup: if storeId changes before fetch completes, ignore stale result
    return () => { cancelled = true }
  }, [storeId, audience])

  useEffect(() => {
    if (!storeId) return undefined

    void refreshStoreReviewSummary(storeId, audience).catch((error) => {
      console.warn('Failed to refresh store review summary:', error?.message)
    })

    const intervalId = window.setInterval(() => {
      void refreshStoreReviewSummary(storeId, audience).catch((error) => {
        console.warn('Failed to refresh store review summary:', error?.message)
      })
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [storeId, audience])

  const stateMatchesStore = state.storeId === storeId && state.audience === audience
  return {
    summary: hasCachedSummary ? cachedSummary : stateMatchesStore ? state.summary : null,
    loading: !storeId
      ? false
      : hasCachedSummary
        ? false
        : stateMatchesStore
          ? state.loading
          : true,
    error: stateMatchesStore ? state.error : null,
  }
}
