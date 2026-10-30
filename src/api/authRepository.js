// src/api/authRepository.js
// Owns password and email OTP authentication operations. Temporary Auth clients
// keep proof sessions out of the app's persisted session.

import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { passwordRecoverySupabase } from '../lib/passwordRecoverySupabase'
import { apiKeyOnlyFetch } from '../lib/apiKeyOnlyFetch'
import { getCaptchaOptions } from '../lib/captcha'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const PASSWORD_PROOF_MAX_AGE_SECONDS = 10 * 60

let passwordAuthClient = null
let passwordProofSession = null
let otpAuthClient = null
let pendingLoginEmail = ''

function createEphemeralAuthClient() {
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: apiKeyOnlyFetch(supabasePublishableKey) },
  })
}

function decodeAccessToken(accessToken) {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function ensureAppAccess(session) {
  const claims = session?.access_token ? decodeAccessToken(session.access_token) : null
  if (claims?.app_access !== true) {
    throw new Error('서버 로그인 보안 설정을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.')
  }
}

export function hasPendingLogin(email) {
  if (
    !passwordProofSession?.access_token ||
    pendingLoginEmail !== String(email || '').trim().toLowerCase()
  ) return false

  const claims = decodeAccessToken(passwordProofSession.access_token)
  const now = Math.floor(Date.now() / 1000)
  return Boolean(
    claims &&
    Number.isFinite(Number(claims.iat)) &&
    Number.isFinite(Number(claims.exp)) &&
    now - Number(claims.iat) <= PASSWORD_PROOF_MAX_AGE_SECONDS &&
    Number(claims.exp) > now,
  )
}

export async function clearLoginAttempt({ preserveClient = null } = {}) {
  const clients = [passwordAuthClient, otpAuthClient]
    .filter((client) => client && client !== preserveClient)
  passwordAuthClient = null
  passwordProofSession = null
  otpAuthClient = null
  pendingLoginEmail = ''
  await Promise.all(clients.map((client) => client.auth.signOut({ scope: 'local' })))
}

/** Verify credentials in a non-persistent client and keep the proof in memory. */
export async function signInWithPassword(email, password, captchaToken) {
  await clearLoginAttempt()
  passwordAuthClient = createEphemeralAuthClient()

  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await passwordAuthClient.auth.signInWithPassword({
    email: normalizedEmail,
    password,
    options: getCaptchaOptions(captchaToken),
  })

  if (error) {
    await clearLoginAttempt()
    throw new Error(error.message)
  }

  passwordProofSession = data.session
  pendingLoginEmail = normalizedEmail
  return { user: data.user, session: data.session }
}

/** Check whether a pending signup email was confirmed without persisting a session. */
export async function checkSignupEmailConfirmation(email, password, captchaToken = '') {
  const verifier = createEphemeralAuthClient()
  try {
    const options = captchaToken ? getCaptchaOptions(captchaToken) : {}
    const { data, error } = await verifier.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
      options,
    })

    if (error) {
      if (error.code === 'email_not_confirmed') return false
      const checkError = new Error(error.message)
      checkError.code = error.code
      throw checkError
    }

    return Boolean(data.user?.email_confirmed_at)
  } finally {
    await verifier.auth.signOut({ scope: 'local' })
  }
}

/** Persist an allowlisted test/admin password session after the Auth Hook grants it. */
export async function completePasswordOnlyLogin() {
  if (!passwordProofSession || !passwordAuthClient) {
    throw new Error('로그인 정보가 만료되었습니다. 비밀번호를 다시 입력해주세요.')
  }

  const promotedClient = passwordAuthClient
  ensureAppAccess(passwordProofSession)
  const { error } = await supabase.auth.setSession({
    access_token: passwordProofSession.access_token,
    refresh_token: passwordProofSession.refresh_token,
  })
  if (error) throw new Error(error.message)

  // Do not revoke this Auth session: the main client now uses the same tokens.
  await clearLoginAttempt({ preserveClient: promotedClient })
}

/** Send the built-in Supabase email OTP after password proof has been checked. */
export async function sendLoginOtp(email, captchaToken) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!hasPendingLogin(normalizedEmail)) {
    throw new Error('비밀번호 확인이 만료되었습니다. 다시 로그인해주세요.')
  }

  if (!otpAuthClient) otpAuthClient = createEphemeralAuthClient()
  const { error } = await otpAuthClient.auth.signInWithOtp({
    email: normalizedEmail,
    options: { shouldCreateUser: false, ...getCaptchaOptions(captchaToken) },
  })

  if (error) throw new Error(error.message)
}

/** Verify the OTP, prove the separate password session to the server, then persist only the granted session. */
export async function verifyLoginOtp(email, otp) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!hasPendingLogin(normalizedEmail) || !otpAuthClient) {
    throw new Error('비밀번호 확인이 만료되었습니다. 다시 로그인해주세요.')
  }

  const { data, error } = await otpAuthClient.auth.verifyOtp({
    email: normalizedEmail,
    token: otp.trim(),
    type: 'email',
  })
  if (error) throw new Error(error.message)
  if (!data.session) throw new Error('인증 세션을 만들지 못했습니다. 다시 시도해주세요.')

  // A previous confirmation attempt may have confirmed the email but failed
  // to create the member row. Retry that idempotent server-side completion
  // after the user proves both password and email OTP again.
  if (data.user?.user_metadata?.registration) {
    const { data: registrationResult, error: registrationError } =
      await otpAuthClient.functions.invoke('complete-member-registration')
    if (registrationError || !registrationResult?.success) {
      await otpAuthClient.auth.signOut({ scope: 'local' })
      throw new Error(
        registrationResult?.message ||
          registrationError?.message ||
          '이메일 인증은 완료되었지만 회원가입 정보를 저장하지 못했습니다. 코드를 다시 받아 로그인해주세요.',
      )
    }
  }

  const { error: completionError } = await otpAuthClient.functions.invoke('complete-login', {
    body: { passwordAccessToken: passwordProofSession.access_token },
  })
  if (completionError) throw new Error(completionError.message)

  // The Auth Hook adds app_access only after the server records this exact OTP
  // session. Refresh to receive the signed claim before installing it in-app.
  const { data: refreshedData, error: refreshError } = await otpAuthClient.auth.refreshSession()
  if (refreshError) throw new Error(refreshError.message)
  ensureAppAccess(refreshedData.session)

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: refreshedData.session.access_token,
    refresh_token: refreshedData.session.refresh_token,
  })
  if (sessionError) throw new Error(sessionError.message)

  // The OTP client owns the session promoted into the main app client.
  // Revoke only the separate password-proof session during cleanup.
  await clearLoginAttempt({ preserveClient: otpAuthClient })
  return { session: refreshedData.session }
}

/** Resend only while the same in-memory password proof is still pending. */
export async function resendLoginOtp(email, captchaToken) {
  return sendLoginOtp(email, captchaToken)
}

/** Resend the email confirmation link for an unconfirmed account. */
export async function resendConfirmationEmail(email, captchaToken) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: 'https://app.uva-in.nl/email-confirmed',
      ...getCaptchaOptions(captchaToken),
    },
  })

  if (error) throw new Error(error.message)
}

/** Send a password reset link. */
export async function sendPasswordResetEmail(email, captchaToken, returnToken) {
  const redirectTo = typeof window !== 'undefined'
    ? new URL('/reset-password', window.location.origin)
    : undefined
  if (redirectTo && returnToken) redirectTo.searchParams.set('returnToken', returnToken)

  const { error } = await passwordRecoverySupabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo?.toString(),
    ...getCaptchaOptions(captchaToken),
  })
  if (error) throw new Error(error.message)
}

/** Notify the app that requested a reset without sharing account details. */
export async function sendPasswordResetReturnSignal(action, token, recoveryAccessToken) {
  const { data, error } = await supabase.functions.invoke('password-reset-return-signal', {
    body: { action, token },
    ...(recoveryAccessToken
      ? { headers: { Authorization: `Bearer ${recoveryAccessToken}` } }
      : {}),
  })
  if (error) throw new Error(error.message)
  return data?.completed === true
}

/** Change a password using only a verified PKCE recovery session. */
export async function updatePasswordFromRecovery(password) {
  const { error } = await passwordRecoverySupabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}

/** Change a password after verifying the current password in a fresh, non-persistent session. */
export async function updatePassword(password, currentPassword, captchaToken) {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new Error('현재 비밀번호를 입력해주세요.')
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  const email = user?.email?.trim().toLowerCase()
  if (userError || !email) {
    throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요.')
  }

  const verifier = createEphemeralAuthClient()
  try {
    const { error: proofError } = await verifier.auth.signInWithPassword({
      email,
      password: currentPassword,
      options: getCaptchaOptions(captchaToken),
    })
    if (proofError) throw new Error('현재 비밀번호가 올바르지 않습니다.')

    const { error } = await verifier.auth.updateUser({
      password,
      current_password: currentPassword,
    })
    if (error) throw new Error(error.message)
  } finally {
    // Keep the app's persisted session untouched and remove the temporary proof session.
    await verifier.auth.signOut({ scope: 'local' })
  }
}

/** Verify a password without replacing the persisted app session, then request deletion. */
export async function deleteAccountWithPassword(currentPassword, captchaToken) {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new Error('확인을 위해 비밀번호를 입력하세요.')
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user?.email) {
    throw new Error('계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
  }

  const verifier = createEphemeralAuthClient()
  try {
    const { data, error } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
      options: getCaptchaOptions(captchaToken),
    })
    if (error) {
      throw new Error(error.code === 'invalid_credentials'
        ? '비밀번호가 올바르지 않습니다.'
        : '비밀번호를 확인하지 못했습니다. 자동 확인을 완료한 뒤 다시 시도해주세요.')
    }
    if (data.user?.id !== user.id || !data.session?.access_token) {
      throw new Error('비밀번호 확인에 실패했습니다. 다시 시도해주세요.')
    }
    return await supabase.functions.invoke('delete-my-account', {
      body: { passwordAccessToken: data.session.access_token },
    })
  } finally {
    // Revoke only the temporary password proof, including when deletion fails.
    // The member's existing app session remains installed until deletion succeeds.
    try { await verifier.auth.signOut({ scope: 'local' }) } catch {
      // The Auth account may already have been deleted by the request above.
    }
  }
}

/** Sign the current persisted app session out. */
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw new Error(error.message)
}
