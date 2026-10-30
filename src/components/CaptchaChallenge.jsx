import { useEffect, useRef, useState } from 'react'

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || ''
const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let turnstileLoader

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (turnstileLoader) return turnstileLoader

  turnstileLoader = new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${scriptUrl}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = scriptUrl
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }

    const onLoad = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load'))
    const onError = () => reject(new Error('Turnstile could not load'))
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (window.turnstile) onLoad()
  }).catch((error) => {
    turnstileLoader = null
    throw error
  })

  return turnstileLoader
}

export default function CaptchaChallenge({ onVerify, resetKey = 0, language = 'ko', appearance = 'interaction-only', reserveSpace = true }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onVerifyRef = useRef(onVerify)
  const [loadFailed, setLoadFailed] = useState(false)
  const [theme, setTheme] = useState(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    onVerifyRef.current = onVerify
  }, [onVerify])

  useEffect(() => {
    const root = document.documentElement
    const syncTheme = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light')
    const observer = new MutationObserver(syncTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined
    let cancelled = false
    let turnstileApi = null

    loadTurnstile().then((api) => {
      if (cancelled || !containerRef.current) return
      turnstileApi = api
      widgetIdRef.current = api.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        appearance,
        size: 'normal',
        callback: (token) => onVerifyRef.current(token),
        'expired-callback': () => onVerifyRef.current(''),
        'error-callback': () => onVerifyRef.current(''),
      })
      setLoadFailed(false)
    }).catch(() => {
      if (!cancelled) setLoadFailed(true)
    })

    return () => {
      cancelled = true
      onVerifyRef.current('')
      if (widgetIdRef.current !== null) {
        turnstileApi?.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [theme, appearance])

  useEffect(() => {
    if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current)
  }, [resetKey])

  if (!siteKey) return null

  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${reserveSpace ? 'min-h-[73px] py-1' : ''}`}>
      <div ref={containerRef} className={`w-[300px] max-w-full shrink-0 ${reserveSpace ? 'min-h-[65px]' : ''}`} />
      {loadFailed && (
        <p className="text-center text-xs text-red-500">
          {language === 'ko'
            ? '자동 확인을 불러오지 못했습니다. 인터넷 연결을 확인해주세요.'
            : 'Could not load the security check. Check your internet connection.'}
        </p>
      )}
    </div>
  )
}
