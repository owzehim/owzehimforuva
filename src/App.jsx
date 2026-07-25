import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import MemberPage from './pages/MemberPage'
import AdminPage from './pages/AdminPage'
import VerifyPage from './pages/VerifyPage'
import PublicPage from './pages/PublicPage'
import ScanPage from './pages/ScanPage'
import InstallBanner from './components/InstallBanner'
import RegistrationPage from './pages/RegistrationPage'
import EmailConfirmedPage from './pages/EmailConfirmedPage'
import SettingsPage from './pages/SettingsPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import { useSingleDeviceSession } from './hooks/useSingleDeviceSession'
import { useTheme } from './hooks/useTheme'
import { DeviceRotate, WifiX } from '@phosphor-icons/react'
import LoadingIndicator from './components/LoadingIndicator'

const OTP_PENDING_KEY = 'uvain_otp_pending_email'
const OTP_PENDING_EVENT = 'uvain-otp-pending-change'

function isStandaloneApp() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function hasAlienBlockFont() {
  return typeof document === 'undefined' || !document.fonts
    ? true
    : document.fonts.check('900 1em "Alien Block"')
}

function App() {
  useTheme()
  const [session, setSession] = useState(undefined)
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' && !navigator.onLine,
  )
  const [isOtpPending, setIsOtpPending] = useState(() =>
    typeof window !== 'undefined' &&
    Boolean(window.sessionStorage.getItem(OTP_PENDING_KEY))
  )
  const [alienBlockReady, setAlienBlockReady] = useState(hasAlienBlockFont)

  useEffect(() => {
    let cancelled = false

    const loadAlienBlock = async () => {
      if (!navigator.onLine || !document.fonts) return

      setAlienBlockReady(false)
      try {
        await document.fonts.load('900 1em "Alien Block"')
      } finally {
        if (!cancelled) setAlienBlockReady(true)
      }
    }

    loadAlienBlock()
    window.addEventListener('online', loadAlienBlock)

    return () => {
      cancelled = true
      window.removeEventListener('online', loadAlienBlock)
    }
  }, [])

  useEffect(() => {
    const loadSession = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
      })
    }

    const handleOnline = () => {
      setIsOffline(false)
      loadSession()
    }
    const handleOffline = () => setIsOffline(true)

    loadSession()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => {
      subscription.unsubscribe()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const updateOtpPending = () => {
      setIsOtpPending(Boolean(window.sessionStorage.getItem(OTP_PENDING_KEY)))
    }

    window.addEventListener(OTP_PENDING_EVENT, updateOtpPending)
    window.addEventListener('storage', updateOtpPending)

    return () => {
      window.removeEventListener(OTP_PENDING_EVENT, updateOtpPending)
      window.removeEventListener('storage', updateOtpPending)
    }
  }, [])

  useSingleDeviceSession(isOtpPending ? null : session)

  useEffect(() => {
    if (!isStandaloneApp()) return undefined

    const viewport = document.querySelector('meta[name="viewport"]')
    const previousViewport = viewport?.getAttribute('content')
    viewport?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no',
    )

    const preventPinch = (e) => {
      if (e.touches?.length > 1) e.preventDefault()
    }
    const preventGesture = (e) => e.preventDefault()

    document.addEventListener('touchmove', preventPinch, { passive: false })
    document.addEventListener('gesturestart', preventGesture)
    document.addEventListener('gesturechange', preventGesture)

    return () => {
      if (previousViewport) viewport?.setAttribute('content', previousViewport)
      document.removeEventListener('touchmove', preventPinch)
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
    }
  }, [])

  if (isOffline) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-8 text-center dark:bg-[#121212]">
        <WifiX size={64} weight="duotone" className="mb-5 text-gray-400 dark:text-gray-500" />
        <h1 className="text-xl font-black text-gray-950 dark:text-white">인터넷 연결 없음</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-gray-500 dark:text-gray-400">
          Wi-Fi 또는 모바일 데이터를 확인한 뒤 다시 시도해주세요.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-7 rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-white active:bg-orange-600"
        >
          다시 시도
        </button>
      </div>
    )
  }

  if (session === undefined || !alienBlockReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#121212]">
        <LoadingIndicator />
      </div>
    )
  }

  const user = session?.user

  // More robust admin detection:
  const isAdmin =
    user?.user_metadata?.role === 'admin' ||
    user?.email === 'admin@uvain.nl' // fallback, just in case
  const isEmailConfirmationLink =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('code') ||
      window.location.hash.includes('access_token'))

  return (
    <BrowserRouter>
      <InstallBanner />
      <PortraitOrientationBlocker />
      <Routes>
        <Route
          path="/login"
          element={!session || isOtpPending ? <LoginPage /> : <Navigate to="/member" />}
        />

        <Route
          path="/member"
          element={session && !isOtpPending ? <MemberPage /> : <Navigate to={isOtpPending ? '/login' : '/public'} />}
        />
        <Route
          path="/settings"
          element={session && !isOtpPending ? <SettingsPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/settings/password"
          element={session && !isOtpPending ? <ChangePasswordPage /> : <Navigate to="/login" />}
        />

        <Route
          path="/admin"
          element={
            isAdmin && !isOtpPending
              ? <AdminPage />
              : <Navigate to={session ? '/member' : '/login'} />
          }
        />

        <Route
          path="/scan"
          element={session && !isOtpPending ? <ScanPage /> : <Navigate to="/login" />}
        />

        <Route path="/verify/:token" element={<VerifyPage />} />
        <Route path="/public" element={<PublicPage />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            isEmailConfirmationLink
              ? <EmailConfirmedPage />
              : <Navigate to={session && !isOtpPending ? '/member' : '/public'} />
          }
        />

        <Route
          path="*"
          element={<Navigate to={session && !isOtpPending ? '/member' : '/public'} />}
        />
      </Routes>
    </BrowserRouter>
  )
}

function PortraitOrientationBlocker() {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      '(max-width: 767px) and (orientation: landscape)',
    )
    let hideTimer

    const updateOrientation = () => {
      if (mediaQuery.matches) {
        window.clearTimeout(hideTimer)
        setMounted(true)
        window.requestAnimationFrame(() => setVisible(true))
        return
      }

      setVisible(false)
      hideTimer = window.setTimeout(() => setMounted(false), 240)
    }

    updateOrientation()
    mediaQuery.addEventListener('change', updateOrientation)

    return () => {
      window.clearTimeout(hideTimer)
      mediaQuery.removeEventListener('change', updateOrientation)
    }
  }, [])

  if (!mounted) return null

  return (
    <div
      className={`portrait-orientation-blocker${visible ? ' is-visible' : ''}`}
      role="alert"
    >
      <DeviceRotate
        className="portrait-orientation-icon"
        size={64}
        weight="duotone"
        aria-hidden="true"
      />
      <h1>세로 모드로 전환해 주세요</h1>
    </div>
  )
}

export default App
