import { useEffect } from 'react'
import { shouldLockDevInteractions } from './devInteractionPolicy.js'

export function useDevInteractionLock(enabled = true) {
  const shouldLock = shouldLockDevInteractions({
    isViteDev: Boolean(import.meta.env?.DEV),
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  }) && enabled

  useEffect(() => {
    if (!shouldLock) return undefined

    const prevent = (event) => event.preventDefault()
    document.addEventListener('dragstart', prevent, true)

    return () => {
      document.removeEventListener('dragstart', prevent, true)
    }
  }, [shouldLock])

  return shouldLock
}
