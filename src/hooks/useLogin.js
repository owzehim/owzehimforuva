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
} from '../api/authRepository'

const OTP_PENDING_KEY = 'uvain_otp_pending_email'
const OTP_PENDING_EVENT = 'uvain-otp-pending-change'
const MEMBER_ACTIVE_TAB_KEY = 'uvain_member_active_tab'
const MEMBER_EVENT_LIST_OPEN_KEY = 'uvain_member_event_list_open'

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

  const [email, setEmail] = useState(pendingEmail)
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  // ── Step 1: submit email + password ──────────────────────────────────────
  const handleCredentialsSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      setOtpPendingEmail(email)

      // Always verify credentials first
      await signInWithPassword(email, password)

      // OTP-exempt accounts (e.g. admin/test) are fully logged in now.
      // The Supabase Auth Hook, not this client-side email check, grants access.
      if (isOtpExempt(email)) {
        await completePasswordOnlyLogin()
        resetMemberEntryState()
        clearOtpPendingEmail()
        return
      }

      // Keep the short-lived password proof in memory while a separate
      // non-persistent client requests the email OTP.
      await sendLoginOtp(email)
      setStep('otp')
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
  const handleResendOtp = async () => {
    setError('')
    setLoading(true)

    try {
      await sendLoginOtp(email)
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
  const handleResendConfirmation = async () => {
    setError('')
    setLoading(true)

    try {
      await resendConfirmationEmail(email)
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

  const handlePasswordResetSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setResetSuccess(false)

    if (!email.trim()) {
      setError('이메일을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      await sendPasswordResetEmail(email.trim().toLowerCase())
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
    setOtp,
    loading,
    error,
    resendSuccess,
    resetSuccess,
    // Actions
    handleCredentialsSubmit,
    handleOtpSubmit,
    handleResendOtp,
    handleResendConfirmation,
    handleForgotPassword,
    handlePasswordResetSubmit,
    handleBack,
  }
}
