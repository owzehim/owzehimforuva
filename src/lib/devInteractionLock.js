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
    const preventWheelZoom = (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault()
    }
    const preventKeyboardZoom = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (['+', '=', '-', '_', '0'].includes(event.key)) event.preventDefault()
    }

    document.addEventListener('dragstart', prevent, true)
    document.addEventListener('gesturestart', prevent, { passive: false })
    document.addEventListener('gesturechange', prevent, { passive: false })
    window.addEventListener('wheel', preventWheelZoom, { passive: false })
    window.addEventListener('keydown', preventKeyboardZoom, true)

    return () => {
      document.removeEventListener('dragstart', prevent, true)
      document.removeEventListener('gesturestart', prevent)
      document.removeEventListener('gesturechange', prevent)
      window.removeEventListener('wheel', preventWheelZoom)
      window.removeEventListener('keydown', preventKeyboardZoom, true)
    }
  }, [shouldLock])

  return shouldLock
}
