// src/hooks/useLogin.js
//
// React orchestration hook for the full login flow.
// ❌ Do NOT copy to React Native — rewrite with RN navigation patterns.
// But the state machine logic (step: 'credentials' → 'otp' → 'unconfirmed')
// is identical and can be ported directly.

import { useState } from 'react'
import {
  isOtpExempt,
  validateOtpInput,
  mapAuthError,
} from '../domain/auth/authRules'
import {
  signInWithPassword,
  sendLoginOtp,
  verifyLoginOtp,
  resendConfirmationEmail,
  sendPasswordResetEmail,
} from '../api/authRepository'
import { supabase } from '../lib/supabase'

const SKIP_OTP_EMAIL_KEY = 'uvain_skip_otp_once_email'
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

function shouldSkipOtpOnce(email) {
  if (typeof window === 'undefined') return false

  const normalizedEmail = email.trim().toLowerCase()
  const storedEmail = window.localStorage.getItem(SKIP_OTP_EMAIL_KEY)

  if (storedEmail !== normalizedEmail) return false

  window.localStorage.removeItem(SKIP_OTP_EMAIL_KEY)
  return true
}

/**
 * Login flow states:
 * 'credentials' — user enters email + password
 * 'otp'         — user enters the 6-digit code sent to their email
 * 'unconfirmed' — email not confirmed yet, show resend button
 * 'forgot'      — user requests a password reset email
 */
export function useLogin() {
  const pendingEmail = getOtpPendingEmail()
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

      // Right after first signup email confirmation, let the user into the app
      // once without asking for an OTP again.
      if (shouldSkipOtpOnce(email)) {
        resetMemberEntryState()
        clearOtpPendingEmail()
        return
      }

      // OTP-exempt accounts (e.g. admin/test) are fully logged in now.
      // App.jsx onAuthStateChange will handle navigation.
      if (isOtpExempt(email)) {
        resetMemberEntryState()
        clearOtpPendingEmail()
        return
      }

      // Non-exempt accounts:
      // 1) sign out the temp password session
      // 2) send a 6-digit OTP to the email
      // 3) move to OTP step; real session will be created after OTP verify
      // This session exists only to validate the password. Clearing it locally
      // avoids an unnecessary second Auth network request (and the generic
      // "Load Failed" error it could surface) before the OTP request.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError

      await sendLoginOtp(email)
      setStep('otp')
    } catch (err) {
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
      setError(mapAuthError(err.message))
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
      setError(mapAuthError(err.message))
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
