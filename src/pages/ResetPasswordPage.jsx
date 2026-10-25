import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Eye, EyeSlash } from '@phosphor-icons/react'
import { sendPasswordResetReturnSignal, updatePasswordFromRecovery } from '../api/authRepository'
import { supabase } from '../lib/supabase'
import { passwordRecoverySupabase } from '../lib/passwordRecoverySupabase'

let recoveryExchangeCode = null
let recoveryExchangePromise = null

function exchangeRecoveryCodeOnce(code) {
  if (recoveryExchangeCode === code && recoveryExchangePromise) {
    return recoveryExchangePromise
  }

  recoveryExchangeCode = code
  recoveryExchangePromise = passwordRecoverySupabase.auth.exchangeCodeForSession(code)
  return recoveryExchangePromise
}

async function getVerifiedRecoverySession() {
  const { data: { session }, error: sessionError } =
    await passwordRecoverySupabase.auth.getSession()
  if (sessionError || !session) return null

  // Ask Auth to validate the session instead of decoding claims locally. This
  // also avoids rejecting a valid recovery session because a claims/JWKS read
  // failed independently.
  const { data: { user }, error } = await passwordRecoverySupabase.auth.getUser()
  if (error || user?.id !== session.user?.id) return null
  return session
}

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [resetCompleted, setResetCompleted] = useState(false)
  const returnTokenRef = useRef('')
  const returnHomeTimerRef = useRef(null)

  useEffect(() => {
    let active = true
    const verifyRecoverySession = async () => {
      try {
        const url = new URL(window.location.href)
        returnTokenRef.current = url.searchParams.get('returnToken') || ''
        const hash = new URLSearchParams(url.hash.slice(1))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')

        if (hash.get('type') === 'recovery' && accessToken && refreshToken) {
          const { data: sessionData, error: sessionError } =
            await passwordRecoverySupabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
          if (sessionError) {
            console.error('Password recovery session setup failed:', sessionError.message)
          } else if (sessionData?.session) {
            url.hash = ''
            window.history.replaceState(
              window.history.state,
              '',
              `${url.pathname}${url.search}`,
            )
            if (active) setRecoveryReady(true)
            return
          }
        }

        // Keep handling reset links issued before the callback switched to
        // implicit flow. Those links still require their original PKCE verifier.
        const code = url.searchParams.get('code')
        if (code) {
          const { data: exchangeData, error: exchangeError } = await exchangeRecoveryCodeOnce(code)
          if (exchangeError) {
            console.error('Password recovery link exchange failed:', exchangeError.message)
          } else if (exchangeData?.session) {
            url.searchParams.delete('code')
            window.history.replaceState(
              window.history.state,
              '',
              `${url.pathname}${url.search}${url.hash}`,
            )
            if (active) setRecoveryReady(true)
            return
          }
        }

        const session = await getVerifiedRecoverySession()
        if (active) setRecoveryReady(Boolean(session))
      } catch (error) {
        console.error('Password recovery session check failed:', error?.message || 'unknown error')
        if (active) setRecoveryReady(false)
      }
    }
    void verifyRecoverySession()

    const { data: { subscription } } = passwordRecoverySupabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryReady(true)
      } else if (event === 'SIGNED_OUT') {
        setRecoveryReady(false)
      }
    })
    return () => {
      active = false
      if (returnHomeTimerRef.current) window.clearTimeout(returnHomeTimerRef.current)
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!recoveryReady) {
      setError('재설정 링크가 만료되었거나 유효하지 않습니다. 새 링크를 요청해주세요.')
      return
    }

    if (password.length < 8) {
      setError('비밀번호는 최소 8자 이상이어야 합니다.')
      return
    }

    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    try {
      const recoverySession = await getVerifiedRecoverySession()
      if (!recoverySession) {
        setRecoveryReady(false)
        throw new Error('재설정 링크가 만료되었거나 유효하지 않습니다. 새 링크를 요청해주세요.')
      }

      await updatePasswordFromRecovery(password)
      if (returnTokenRef.current) {
        try {
          await sendPasswordResetReturnSignal(
            'complete',
            returnTokenRef.current,
            recoverySession.access_token,
          )
        } catch (signalError) {
          console.error('Could not notify the app about password reset completion:', signalError?.message || 'unknown error')
        }
      }
      const { error: otherSessionsError } =
        await passwordRecoverySupabase.auth.signOut({ scope: 'others' })
      const { error: localSignOutError } =
        await passwordRecoverySupabase.auth.signOut({ scope: 'local' })
      if (localSignOutError) throw localSignOutError
      if (otherSessionsError) console.error('Could not revoke other sessions after password reset')

      const { data: { session: appSession } } = await supabase.auth.getSession()
      if (appSession?.user?.id && appSession.user.id === recoverySession?.user?.id) {
        const { error: appSignOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (appSignOutError) throw appSignOutError
      }
      setResetCompleted(true)
      returnHomeTimerRef.current = window.setTimeout(() => {
        navigate('/public', { replace: true })
      }, 5000)
    } catch (err) {
      setError(err.message || '비밀번호 변경 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  if (resetCompleted) {
    return (
      <main
        className="phone-app-shell flex min-h-[100dvh] items-center justify-center bg-white px-4 text-gray-900 dark:bg-[#121212] dark:text-white"
        role="status"
        aria-live="polite"
      >
        <div className="w-full max-w-sm px-2 text-center">
          <CheckCircle size={56} weight="fill" color="#f97316" className="mx-auto mb-4" />
          <h1 className="text-2xl font-semibold">비밀번호가 변경되었습니다</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            새 비밀번호로 로그인을 진행해 주세요
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="phone-app-shell flex min-h-[100dvh] items-start justify-center overflow-hidden bg-white px-4 pt-[16vh]">
      <div className="w-full max-w-sm px-2">
        <div className="mb-8 min-h-[176px] pt-[54px] text-left">
          <h1 className="text-2xl font-semibold text-gray-900">새 비밀번호 설정</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            새 비밀번호를 입력해주세요
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <ResetField label="새 비밀번호">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-9`}
                  required
                />
              </ResetField>
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-gray-500"
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="relative">
              <ResetField label="새 비밀번호 확인">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`${inputClass} pr-9`}
                  required
                />
              </ResetField>
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                aria-label={showConfirmPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-gray-500"
              >
                {showConfirmPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full rounded-full bg-orange-500 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {loading ? '변경 중...' : '비밀번호 변경'}
            </button>
        </form>
      </div>
    </div>
  )
}

function ResetField({ label, children }) {
  return (
    <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600">
      <span className="text-xs font-normal leading-none text-gray-500">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full border-none bg-white p-0 text-sm text-gray-900 outline-none placeholder:text-transparent focus:outline-none'
