import { useState, useEffect, useCallback, useRef } from 'react'
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
  const channelIdRef = useRef(
    Math.random().toString(36).slice(2) + Date.now().toString(36),
  )
  const [visits, setVisits] = useState([])
  const [stampState, setStampState] = useState(EMPTY_STATE)
  const [pendingReward, setPendingReward] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!userId || !restaurantId || !totalStamps) {
      setVisits([])
      setStampState(EMPTY_STATE)
      setPendingReward(null)
      return
    }

    setLoading(true)
    try {
      const [data, reward] = await Promise.all([
        fetchVisits(userId, restaurantId),
        fetchPendingReward(userId, restaurantId),
      ])
      setVisits(data)
      setPendingReward(reward)
      setStampState(computeStampState(data, totalStamps, reward))
    } catch (e) {
      console.warn('fetchVisits error:', e)
      setVisits([])
      setPendingReward(null)
      setStampState(EMPTY_STATE)
    } finally {
      setLoading(false)
    }
  }, [userId, restaurantId, totalStamps])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!userId || !restaurantId || !totalStamps) return undefined

    const channel = supabase
      .channel(`stamp-card-visits:${restaurantId}:${userId}:${channelIdRef.current}`)
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
  }, [load, restaurantId, totalStamps, userId])

  return { visits, stampState, pendingReward, loading, refetch: load }
}
