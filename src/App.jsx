import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { hasAdminRole } from './lib/adminRoles'
import LoginPage from './pages/LoginPage'
import MemberPage from './pages/MemberPage'
import TutorialPreviewPage from './pages/TutorialPreviewPage'
import PublicPage from './pages/PublicPage'
import InstallBanner from './components/InstallBanner'
import UpdatePrompt from './components/UpdatePrompt'
import LegalConsentPage from './pages/LegalConsentPage'
import { useSingleDeviceSession } from './hooks/useSingleDeviceSession'
import { useTheme } from './hooks/useTheme'
import { WifiX } from '@phosphor-icons/react'
import LoadingIndicator from './components/LoadingIndicator'
import { lazyPage } from './lib/lazyPage'
import DevScreenInteractionLock from './components/DevScreenInteractionLock'
import ZoomViewportMinimap from './components/ZoomViewportMinimap'
import LandscapeInputFocusGuard from './components/LandscapeInputFocusGuard'
import { hasAppAccessClaim } from './domain/auth/authRules'
import { LEGAL_DOCUMENT_VERSION } from './content/legalDocuments'
import { hasCurrentLegalConsent } from './domain/legalConsent'

// PERF-01: pages most members never open on a visit load on demand. The login,
// public, member and policy screens stay in the first download.
const AdminPage = lazyPage(() => import('./pages/AdminPage'))
const ScanPage = lazyPage(() => import('./pages/ScanPage'))
const RegistrationPage = lazyPage(() => import('./pages/RegistrationPage'))
const EmailConfirmedPage = lazyPage(() => import('./pages/EmailConfirmedPage'))
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'))
const ChangePasswordPage = lazyPage(() => import('./pages/ChangePasswordPage'))
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'))
const ContentReportPage = lazyPage(() => import('./pages/ContentReportPage'))
const LegalPage = lazyPage(() => import('./pages/LegalPage'))
const ThirdPartyLicensesPage = lazyPage(() => import('./pages/ThirdPartyLicensesPage'))

const OTP_PENDING_KEY = 'uvain_otp_pending_email'
const OTP_PENDING_EVENT = 'uvain-otp-pending-change'

function App() {
  useTheme()
  const [session, setSession] = useState(undefined)
  const [adminRoleState, setAdminRoleState] = useState(null)
  const [legalConsentState, setLegalConsentState] = useState(null)
  const [legalConsentCheckKey, setLegalConsentCheckKey] = useState(0)
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' && !navigator.onLine,
  )
  const [isOtpPending, setIsOtpPending] = useState(() =>
    typeof window !== 'undefined' &&
    Boolean(window.sessionStorage.getItem(OTP_PENDING_KEY))
  )
  const appSession = hasAppAccessClaim(session?.access_token) ? session : null
  const userId = appSession?.user?.id ?? null
  const sessionClaimed = useSingleDeviceSession(isOtpPending ? null : appSession)
  const protectedSession = Boolean(appSession && !isOtpPending && sessionClaimed)
  const adminRoleLoaded = !userId || adminRoleState?.userId === userId
  const isAdmin = adminRoleLoaded && adminRoleState?.isAdmin === true

  const refreshLegalConsent = useCallback(() => {
    setLegalConsentCheckKey((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!userId || isOtpPending || !sessionClaimed) {
      setLegalConsentState(null)
      return undefined
    }

    let cancelled = false
    // PERF-12: when re-checking for the same user, keep the previous result
    // on screen instead of switching to the loading state (which remounts
    // the member, scanner and admin screens).
    const keepPrevious = (current) => current?.userId === userId &&
      (current.status === 'accepted' || current.status === 'required')
    setLegalConsentState((current) => keepPrevious(current) ? current : { userId, status: 'loading' })

    const failed = () => setLegalConsentState((current) => keepPrevious(current) ? current : { userId, status: 'error' })

    supabase.functions.invoke('manage-legal-consent', { body: { action: 'status' } })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || data?.success !== true) {
          failed()
          return
        }
        // GDPR-19: the server decides which version is current, so app and
        // server can never disagree (the bundled value is only a fallback).
        const requiredVersion = typeof data.requiredVersion === 'string' && data.requiredVersion
          ? data.requiredVersion
          : LEGAL_DOCUMENT_VERSION
        const accepted = hasCurrentLegalConsent(data.receipts, requiredVersion)
        setLegalConsentState({ userId, status: accepted ? 'accepted' : 'required' })
      })
      .catch(() => {
        if (!cancelled) failed()
      })

    return () => { cancelled = true }
    // PERF-12: not keyed on access_token — a routine token refresh (hourly,
    // or when the app returns to the foreground) must not re-run the gate.
  }, [userId, isOtpPending, sessionClaimed, legalConsentCheckKey])

  useEffect(() => {
    let cancelled = false

    if (!userId || !sessionClaimed) {
      return () => { cancelled = true }
    }

    hasAdminRole(userId).then((result) => {
      if (!cancelled) setAdminRoleState({ userId, isAdmin: result })
    })

    return () => { cancelled = true }
  }, [userId, appSession?.access_token, sessionClaimed])

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

  if (isOffline) {
    return (
      <DevScreenInteractionLock>
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
      </DevScreenInteractionLock>
    )
  }

  // A missing decorative font must not hold the whole app on its loading screen.
  // The browser swaps it in when ready, using the existing fallback meanwhile.
  if (session === undefined) {
    return (
      <DevScreenInteractionLock>
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#121212]">
          <LoadingIndicator fullScreen />
        </div>
      </DevScreenInteractionLock>
    )
  }

  const isEmailConfirmationLink =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('code') ||
      window.location.hash.includes('access_token'))
  const isPasswordSettingsPreview = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'form'
  const isTutorialPreview = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'tutorial'
  const isMemberScreenPreview = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'screen'
  const isSettingsPreview = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'screen'

  const consentForCurrentUser = legalConsentState?.userId === userId
    ? legalConsentState.status
    : 'loading'
  const protectWithConsent = (element, unauthenticatedPath = '/login') => {
    if (!protectedSession) {
      return appSession && !isOtpPending ? <LoadingIndicator fullScreen /> : <Navigate to={isOtpPending ? '/login' : unauthenticatedPath} />
    }
    if (consentForCurrentUser === 'loading') return <LoadingIndicator fullScreen />
    if (consentForCurrentUser === 'error') {
      return <DevScreenInteractionLock><LegalConsentPage statusError onRetry={refreshLegalConsent} /></DevScreenInteractionLock>
    }
    if (consentForCurrentUser === 'required') return <Navigate to="/legal-consent" replace />
    return element
  }

  const renderLegalConsent = () => {
    if (!protectedSession) {
      return appSession && !isOtpPending ? <LoadingIndicator fullScreen /> : <Navigate to="/login" replace />
    }
    if (consentForCurrentUser === 'loading') return <LoadingIndicator fullScreen />
    if (consentForCurrentUser === 'error') {
      return <LegalConsentPage statusError onRetry={refreshLegalConsent} />
    }
    if (consentForCurrentUser === 'accepted') return <Navigate to="/member" replace />
    return (
      <LegalConsentPage
        onAccepted={() => setLegalConsentState({ userId, status: 'accepted' })}
      />
    )
  }

  const devScreen = (element) => <DevScreenInteractionLock>{element}</DevScreenInteractionLock>

  return (
    <BrowserRouter>
      <InstallBanner />
      <UpdatePrompt />
      <ZoomViewportMinimap />
      <LandscapeInputFocusGuard />
      <Suspense fallback={<LoadingIndicator fullScreen />}>
      <Routes>
        <Route
          path="/login"
          element={devScreen(!appSession || isOtpPending ? <LoginPage /> : <Navigate to="/member" />)}
        />

        <Route
          path="/member"
          element={devScreen(
            isTutorialPreview
              ? <TutorialPreviewPage />
              : isMemberScreenPreview
                ? <MemberPage previewOnly />
              : protectWithConsent(<MemberPage userId={userId} userEmail={appSession?.user?.email || ''} isAdmin={isAdmin} />, '/public'),
          )}
        />
        <Route
          path="/settings"
          element={devScreen(
            isSettingsPreview
              ? <SettingsPage previewOnly />
              : protectWithConsent(<SettingsPage userId={userId} isAdmin={isAdmin} />),
          )}
        />
        <Route
          path="/settings/password"
          element={devScreen(
            isPasswordSettingsPreview
              ? <ChangePasswordPage previewOnly />
              : protectWithConsent(<ChangePasswordPage />),
          )}
        />

        <Route
          path="/admin"
          element={
            devScreen(
              !adminRoleLoaded
                ? <LoadingIndicator fullScreen />
                : isAdmin
                  ? protectWithConsent(<AdminPage />)
                  : <Navigate to={appSession ? '/member' : '/login'} />
            )
          }
        />

        <Route
          path="/scan"
          element={devScreen(protectWithConsent(<ScanPage />))}
        />

        <Route path="/public" element={<PublicPage />} />
        <Route path="/legal" element={devScreen(<LegalPage />)} />
        <Route path="/legal-consent" element={devScreen(renderLegalConsent())} />
        <Route path="/licenses" element={devScreen(<ThirdPartyLicensesPage />)} />
        <Route path="/report-content" element={devScreen(<ContentReportPage />)} />
        <Route path="/register" element={devScreen(<RegistrationPage />)} />
        <Route path="/email-confirmed" element={devScreen(<EmailConfirmedPage />)} />
        <Route path="/reset-password" element={devScreen(<ResetPasswordPage />)} />
        <Route
          path="/"
          element={
            isEmailConfirmationLink
              ? devScreen(<EmailConfirmedPage />)
              : <Navigate to={appSession && !isOtpPending ? '/member' : (session ? '/login' : '/public')} />
          }
        />

        <Route
          path="*"
          element={<Navigate to={appSession && !isOtpPending ? '/member' : (session ? '/login' : '/public')} />}
        />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
