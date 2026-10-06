import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CHECK_INTERVAL_MS = 15000

/** Claim the server-enforced device session before protected pages load. */
export function useSingleDeviceSession(session) {
  const userId = session?.user?.id ?? null
  const accessToken = session?.access_token ?? null
  const [claimedAccessToken, setClaimedAccessToken] = useState(null)

  useEffect(() => {
    if (!userId || !accessToken) return undefined

    let cancelled = false
    let claimSucceeded = false

    const signOutThisDevice = async () => {
      if (cancelled) return
      setClaimedAccessToken(null)
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
      if (data !== true) await signOutThisDevice()
    }

    const claimThisDevice = async () => {
      const { data, error } = await supabase.rpc('claim_single_device_session')
      if (cancelled) return
      if (error || data !== true) {
        console.warn('single device session claim failed:', error?.message || 'claim rejected')
        await signOutThisDevice()
        return
      }

      claimSucceeded = true
      setClaimedAccessToken(accessToken)
      await checkCurrentDevice()
    }

    void claimThisDevice()
    const intervalId = window.setInterval(checkCurrentDevice, CHECK_INTERVAL_MS)
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') void checkCurrentDevice()
    }
    document.addEventListener('visibilitychange', visibilityHandler)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
  }, [userId, accessToken])

  return Boolean(accessToken && claimedAccessToken === accessToken)
}
