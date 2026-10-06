import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { supabase } from '../../../lib/supabase'
import { fetchVisits } from '../api/visits'
import { fetchPendingReward } from '../api/rewards'
import { computeStampState } from '../utils'

const EMPTY_STATE = {
  totalVisits: 0,
  currentCycle: 1,
  stampsInCurrentCycle: 0,
  isCardFull: false,
  hasPendingReward: false,
  pendingReward: null,
  currentCycleVisits: [],
}

export function useUserStampVisits({ userId, restaurantId, totalStamps }) {
  const channelId = useId()
  const queryKey = userId && restaurantId && totalStamps
    ? `${userId}:${restaurantId}:${totalStamps}`
    : null
  const [snapshot, setSnapshot] = useState({
    key: null,
    visits: [],
    stampState: EMPTY_STATE,
    pendingReward: null,
  })
  const requestSequenceRef = useRef(0)

  const fetchSnapshot = useCallback(async () => {
    if (!queryKey) return null

    const [data, reward] = await Promise.all([
        fetchVisits(userId, restaurantId),
        fetchPendingReward(userId, restaurantId),
    ])
    return {
      key: queryKey,
      visits: data,
      pendingReward: reward,
      stampState: computeStampState(data, totalStamps, reward),
    }
  }, [userId, restaurantId, totalStamps, queryKey])

  const load = useCallback(async () => {
    if (!queryKey) return

    const requestSequence = ++requestSequenceRef.current
    try {
      const nextSnapshot = await fetchSnapshot()
      if (requestSequence !== requestSequenceRef.current) return
      if (nextSnapshot) setSnapshot(nextSnapshot)
    } catch (e) {
      if (requestSequence !== requestSequenceRef.current) return
      console.warn('fetchVisits error:', e)
      setSnapshot({
        key: queryKey,
        visits: [],
        pendingReward: null,
        stampState: EMPTY_STATE,
      })
    }
  }, [fetchSnapshot, queryKey])

  useEffect(() => {
    if (!queryKey) return undefined

    let cancelled = false
    const requestSequence = ++requestSequenceRef.current

    fetchSnapshot()
      .then((nextSnapshot) => {
        if (!cancelled && requestSequence === requestSequenceRef.current && nextSnapshot) {
          setSnapshot(nextSnapshot)
        }
      })
      .catch((error) => {
        if (cancelled || requestSequence !== requestSequenceRef.current) return
        console.warn('fetchVisits error:', error)
        setSnapshot({ key: queryKey, visits: [], pendingReward: null, stampState: EMPTY_STATE })
      })

    return () => { cancelled = true }
  }, [fetchSnapshot, queryKey])

  useEffect(() => {
    if (!userId || !restaurantId || !totalStamps) return undefined

    const channel = supabase
      .channel(`stamp-card-visits:${restaurantId}:${userId}:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stamp_card_visits',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const row = payload.new?.user_id ? payload.new : payload.old
          if (row?.user_id === userId) load()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stamp_card_rewards',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const row = payload.new?.user_id ? payload.new : payload.old
          if (row?.user_id === userId) load()
        },
      )
      .subscribe()

    const handleFocus = () => load()
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
      supabase.removeChannel(channel)
    }
  }, [channelId, load, restaurantId, totalStamps, userId])

  const isCurrentSnapshot = snapshot.key === queryKey && queryKey !== null

  return {
    visits: isCurrentSnapshot ? snapshot.visits : [],
    stampState: isCurrentSnapshot ? snapshot.stampState : EMPTY_STATE,
    pendingReward: isCurrentSnapshot ? snapshot.pendingReward : null,
    loading: Boolean(queryKey && !isCurrentSnapshot),
    refetch: load,
  }
}
