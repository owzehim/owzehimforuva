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

export async function primeStoreReviewSummaries(storeIds) {
  const missingStoreIds = Array.from(
    new Set((storeIds || []).filter((storeId) => storeId && !summaryCache.has(storeId))),
  )
  if (missingStoreIds.length === 0) return

  const { data } = await getStoreReviewSummaries(missingStoreIds)
  for (const summary of data || []) {
    summaryCache.set(summary.store_id, summary)
  }
}

export function useStoreReviewSummary(storeId) {
  const hasCachedSummary = Boolean(storeId && summaryCache.has(storeId))
  const cachedSummary = hasCachedSummary ? summaryCache.get(storeId) : null
  const [state, setState] = useState({
    storeId: null,
    summary: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!storeId || summaryCache.has(storeId)) return undefined

    let cancelled = false

    async function fetchSummary() {
      const { data, error: fetchError } = await getStoreReviewSummary(storeId)

      if (cancelled) return

      if (fetchError) {
        setState({
          storeId,
          summary: null,
          loading: false,
          error: fetchError.message ?? '리뷰를 불러오지 못했습니다.',
        })
      } else {
        summaryCache.set(storeId, data)
        setState({ storeId, summary: data, loading: false, error: null })
      }
    }

    void fetchSummary()

    // Cleanup: if storeId changes before fetch completes, ignore stale result
    return () => { cancelled = true }
  }, [storeId])

  const stateMatchesStore = state.storeId === storeId
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
