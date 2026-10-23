import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSessionId } from '../domain/auth/authRules'

const CHECK_INTERVAL_MS = 15000
const CLAIM_RETRY_DELAY_MS = 10000

/** Claim once per login session, then check that the server still recognizes this device. */
export function useSingleDeviceSession(session) {
  const userId = session?.user?.id ?? null
  const accessToken = session?.access_token ?? null
  const sessionId = getSessionId(accessToken)
  const sessionKey = userId && accessToken
    ? [userId, sessionId || accessToken].join(':')
    : null
  const [claimedSessionKey, setClaimedSessionKey] = useState(null)

  useEffect(() => {
    if (!sessionKey) return undefined

    let cancelled = false
    let claimSucceeded = false
    let claimAttempts = 0
    let claimInFlight = false
    let retryTimer = null

    const signOutThisDevice = async () => {
      if (cancelled) return
      setClaimedSessionKey(null)
      await supabase.auth.signOut({ scope: 'local' })
    }

    const checkCurrentDevice = async () => {
      if (!claimSucceeded) return

      const { data, error } = await supabase.rpc('is_current_device_session')
      if (cancelled) return
      if (error) {
        console.warn('single device session check failed:', error.message)
        return
      }
      if (data === false) await signOutThisDevice()
    }

    const scheduleClaimRetry = (message) => {
      claimAttempts += 1
      console.warn('single device session claim failed:', message)
      retryTimer = window.setTimeout(
        claimThisDevice,
        Math.min(claimAttempts * 1000, CLAIM_RETRY_DELAY_MS),
      )
    }

    const claimThisDevice = async () => {
      if (cancelled || claimSucceeded || claimInFlight) return

      claimInFlight = true
      let result
      try {
        result = await supabase.rpc('claim_single_device_session')
      } catch (error) {
        claimInFlight = false
        if (cancelled) return
        scheduleClaimRetry(error?.message || 'network error; retrying')
        return
      }
      claimInFlight = false
      if (cancelled) return

      const { data, error } = result

      if (!error && data === true) {
        claimSucceeded = true
        setClaimedSessionKey(sessionKey)
        await checkCurrentDevice()
        return
      }

      if (!error && data === false) {
        await signOutThisDevice()
        return
      }

      scheduleClaimRetry(error?.message || 'claim result unavailable; retrying')
    }

    void claimThisDevice()
    const intervalId = window.setInterval(checkCurrentDevice, CHECK_INTERVAL_MS)
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        if (claimSucceeded) void checkCurrentDevice()
        else void claimThisDevice()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
  }, [sessionKey])

  return Boolean(sessionKey && claimedSessionKey === sessionKey)
}