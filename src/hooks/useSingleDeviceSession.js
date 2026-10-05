import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const CHECK_INTERVAL_MS = 15000
const TOKEN_KEY_PREFIX = 'uvain_active_device_token'

function getTokenKey(userId) {
  return `${TOKEN_KEY_PREFIX}:${userId}`
}

function createDeviceToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getOrCreateDeviceToken(tokenKey) {
  if (typeof window === 'undefined') return createDeviceToken()

  const storedToken = window.localStorage.getItem(tokenKey)
  if (storedToken) return storedToken

  const nextToken = createDeviceToken()
  window.localStorage.setItem(tokenKey, nextToken)
  return nextToken
}

function isAdminUser(user) {
  return user?.user_metadata?.role === 'admin' || user?.email === 'admin@uvain.nl'
}

export function useSingleDeviceSession(session) {
  const activeUserIdRef = useRef(null)

  useEffect(() => {
    const user = session?.user
    if (!user || isAdminUser(user)) return undefined

    const userId = user.id
    const tokenKey = getTokenKey(userId)
    const deviceToken = getOrCreateDeviceToken(tokenKey)
    let cancelled = false
    let claimSucceeded = false

    activeUserIdRef.current = userId

    const signOutStaleDevice = async () => {
      if (cancelled) return

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(tokenKey)
      }

      await supabase.auth.signOut()
    }

    const claimThisDevice = async () => {
      const { error } = await supabase
        .from('members')
        .update({ session_token: deviceToken })
        .eq('user_id', userId)

      if (error) {
        console.warn('single device session claim failed:', error.message)
        return false
      }

      claimSucceeded = true
      return true
    }

    const checkCurrentDevice = async () => {
      if (!claimSucceeded) return

      const localToken =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(tokenKey)
          : deviceToken

      if (!localToken || localToken !== deviceToken) {
        await signOutStaleDevice()
        return
      }

      const { data, error } = await supabase
        .from('members')
        .select('session_token')
        .eq('user_id', userId)
        .maybeSingle()

      if (cancelled || error || !data) return

      if (data.session_token && data.session_token !== deviceToken) {
        await signOutStaleDevice()
      }
    }

    claimThisDevice().then((claimed) => {
      if (claimed) checkCurrentDevice()
    })

    const intervalId = window.setInterval(checkCurrentDevice, CHECK_INTERVAL_MS)
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        checkCurrentDevice()
      }
    }

    document.addEventListener('visibilitychange', visibilityHandler)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', visibilityHandler)

      if (activeUserIdRef.current === userId) {
        activeUserIdRef.current = null
      }
    }
  }, [session?.user?.id])
}
