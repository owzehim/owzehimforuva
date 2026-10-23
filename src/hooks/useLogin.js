// src/hooks/useLogin.js
//
// React orchestration hook for the full login flow.
// ❌ Do NOT copy to React Native — rewrite with RN navigation patterns.
// But the state machine logic (step: 'credentials' → 'otp' → 'unconfirmed')
// is identical and can be ported directly.

import { useEffect, useState } from 'react'
import {
  isOtpExempt,
  validateOtpInput,
  mapAuthError,
} from '../domain/auth/authRules'
import {
  signInWithPassword,
  sendLoginOtp,
  verifyLoginOtp,
  completePasswordOnlyLogin,
  clearLoginAttempt,
  hasPendingLogin,
  resendConfirmationEmail,
  sendPasswordResetEmail,
  sendPasswordResetReturnSignal,
} from '../api/authRepository'

const OTP_PENDING_KEY = 'uvain_otp_pending_email'
const OTP_PENDING_EVENT = 'uvain-otp-pending-change'
const MEMBER_ACTIVE_TAB_KEY = 'uvain_member_active_tab'
const MEMBER_EVENT_LIST_OPEN_KEY = 'uvain_member_event_list_open'
const PASSWORD_RESET_RETURN_KEY = 'uvain_password_reset_return_token'

function getPasswordResetReturnToken() {
  try {
    return window.localStorage.getItem(PASSWORD_RESET_RETURN_KEY) || ''
  } catch {
    return ''
  }
}

function clearPasswordResetReturnToken() {
  try {
    window.localStorage.removeItem(PASSWORD_RESET_RETURN_KEY)
  } catch {
    // The in-memory flow can still finish when storage is unavailable.
  }
}

function emitOtpPendingChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OTP_PENDING_EVENT))
  }
}

function setOtpPendingEmail(email) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(OTP_PENDING_KEY, email.trim().toLowerCase())
  emitOtpPendingChange()
}

function getOtpPendingEmail() {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(OTP_PENDING_KEY) || ''
}

function clearOtpPendingEmail() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(OTP_PENDING_KEY)
  emitOtpPendingChange()
}

function resetMemberEntryState() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(MEMBER_ACTIVE_TAB_KEY)
  window.sessionStorage.removeItem(MEMBER_EVENT_LIST_OPEN_KEY)
}

/**
 * Login flow states:
 * 'credentials' — user enters email + password
 * 'otp'         — user enters the 6-digit code sent to their email
 * 'unconfirmed' — email not confirmed yet, show resend button
 * 'forgot'      — user requests a password reset email
 */
export function useLogin() {
  const [pendingEmail] = useState(() => {
    const storedEmail = getOtpPendingEmail()
    return hasPendingLogin(storedEmail) ? storedEmail : ''
  })
  useEffect(() => {
    if (!pendingEmail && getOtpPendingEmail()) clearOtpPendingEmail()
  }, [pendingEmail])
  const [step, setStep] = useState(pendingEmail ? 'otp' : 'credentials') // 'credentials' | 'otp' | 'unconfirmed'
  const [otpSent, setOtpSent] = useState(Boolean(pendingEmail))

  const [email, setEmail] = useState(pendingEmail)
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [resetReturnToken, setResetReturnToken] = useState(getPasswordResetReturnToken)

  useEffect(() => {
    if (!resetReturnToken) return undefined

    let active = true
    let checking = false
    const checkForCompletedReset = async () => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try {
        const completed = await sendPasswordResetReturnSignal('check', resetReturnToken)
        if (!active || !completed) return
        clearPasswordResetReturnToken()
        setResetReturnToken('')
        setStep('credentials')
        setResetSuccess(false)
        setError('')
      } catch (err) {
        console.error('Password reset completion check failed:', err?.message || 'unknown error')
      } finally {
        checking = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForCompletedReset()
    }
    void checkForCompletedReset()
    const interval = window.setInterval(() => void checkForCompletedReset(), 5000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [resetReturnToken])

  // ── Step 1: submit email + password ──────────────────────────────────────
  const handleCredentialsSubmit = async (e, captchaToken) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      setOtpPendingEmail(email)

      // Always verify credentials first
      await signInWithPassword(email, password, captchaToken)

      // OTP-exempt accounts (e.g. admin/test) are fully logged in now.
      // The Supabase Auth Hook, not this client-side email check, grants access.
      if (isOtpExempt(email)) {
        await completePasswordOnlyLogin()
        resetMemberEntryState()
        clearOtpPendingEmail()
        return
      }

      // A fresh CAPTCHA token is required for the separate OTP email request.
      setStep('otp')
      setOtpSent(false)
    } catch (err) {
      await clearLoginAttempt()
      clearOtpPendingEmail()
      const mapped = mapAuthError(err.message)

      if (mapped === 'EMAIL_NOT_CONFIRMED') {
        // Email exists but not confirmed yet
        setStep('unconfirmed')
      } else {
        setError(mapped)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRequestOtp = async (captchaToken) => {
    setError('')
    setLoading(true)
    try {
      await sendLoginOtp(email, captchaToken)
      setOtpSent(true)
    } catch (err) {
      await clearLoginAttempt()
      clearOtpPendingEmail()
      setStep('credentials')
      setError(mapAuthError(err.message))
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: submit OTP ───────────────────────────────────────────────────
  const handleOtpSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const validationError = validateOtpInput(otp)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      await verifyLoginOtp(email, otp)
      resetMemberEntryState()
      clearOtpPendingEmail()
      // On success, Supabase sets the session automatically.
      // App.jsx onAuthStateChange will redirect to /member or /admin.
    } catch (err) {
      if (String(err?.message || '').includes('비밀번호 확인이 만료되었습니다')) {
        await clearLoginAttempt()
        clearOtpPendingEmail()
        setOtp('')
        setStep('credentials')
        setError('인증 시간이 지났습니다. 비밀번호를 다시 입력해주세요.')
      } else {
        setError(mapAuthError(err.message))
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Resend OTP (on OTP screen) ───────────────────────────────────────────
  const handleResendOtp = async (captchaToken) => {
    setError('')
    setLoading(true)

    try {
      await sendLoginOtp(email, captchaToken)
      setOtp('')
      setResendSuccess(true)
      setTimeout(() => setResendSuccess(false), 4000)
    } catch (err) {
      if (String(err?.message || '').includes('비밀번호 확인이 만료되었습니다')) {
        await clearLoginAttempt()
        clearOtpPendingEmail()
        setOtp('')
        setStep('credentials')
        setError('인증 시간이 지났습니다. 비밀번호를 다시 입력해주세요.')
      } else {
        setError(mapAuthError(err.message))
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Resend confirmation email (on unconfirmed screen) ────────────────────
  const handleResendConfirmation = async (captchaToken) => {
    setError('')
    setLoading(true)

    try {
      await resendConfirmationEmail(email, captchaToken)
      setResendSuccess(true)
      setTimeout(() => setResendSuccess(false), 4000)
    } catch (err) {
      setError(mapAuthError(err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = () => {
    setStep('forgot')
    setError('')
    setResendSuccess(false)
    setResetSuccess(false)
  }

  const handlePasswordResetSubmit = async (e, captchaToken) => {
    e.preventDefault()
    setError('')
    setResetSuccess(false)

    if (!email.trim()) {
      setError('이메일을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const returnToken = window.crypto.randomUUID()
      await sendPasswordResetEmail(email.trim().toLowerCase(), captchaToken, returnToken)
      try {
        window.localStorage.setItem(PASSWORD_RESET_RETURN_KEY, returnToken)
      } catch {
        // The current page can still observe completion from memory.
      }
      setResetReturnToken(returnToken)
      setResetSuccess(true)
    } catch (err) {
      setError(mapAuthError(err.message))
    } finally {
      setLoading(false)
    }
  }

  // ── Go back to credentials screen ────────────────────────────────────────
  const handleBack = () => {
    void clearLoginAttempt()
    clearOtpPendingEmail()
    setStep('credentials')
    setOtp('')
    setError('')
    setResendSuccess(false)
    setResetSuccess(false)
  }

  return {
    // State
    step,
    email,
    setEmail,
    password,
    setPassword,
    otp,
    otpSent,
    setOtp,
    loading,
    error,
    resendSuccess,
    resetSuccess,
    // Actions
    handleCredentialsSubmit,
    handleOtpSubmit,
    handleRequestOtp,
    handleResendOtp,
    handleResendConfirmation,
    handleForgotPassword,
    handlePasswordResetSubmit,
    handleBack,
  }
}
