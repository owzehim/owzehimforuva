import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { updatePasswordFromRecovery } from '../api/authRepository'
import { isPasswordRecoveryClaims } from '../domain/auth/recovery'
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

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    let active = true
    const verifyRecoverySession = async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error: exchangeError } = await exchangeRecoveryCodeOnce(code)
          if (exchangeError) {
            if (active) setRecoveryReady(false)
            return
          }

          url.searchParams.delete('code')
          window.history.replaceState(
            window.history.state,
            '',
            `${url.pathname}${url.search}${url.hash}`,
          )
        }

        const { data, error } = await passwordRecoverySupabase.auth.getClaims()
        if (active) setRecoveryReady(!error && isPasswordRecoveryClaims(data?.claims))
      } catch {
        if (active) setRecoveryReady(false)
      }
    }
    void verifyRecoverySession()

    const { data: { subscription } } = passwordRecoverySupabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setRecoveryReady(false)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!recoveryReady) {
      setError('이 화면은 비밀번호 재설정 이메일의 링크로만 사용할 수 있습니다.')
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
      const { data, error: claimsError } = await passwordRecoverySupabase.auth.getClaims()
      if (claimsError) throw claimsError
      if (!isPasswordRecoveryClaims(data?.claims)) {
        setRecoveryReady(false)
        throw new Error('이 화면은 비밀번호 재설정 이메일의 링크로만 사용할 수 있습니다.')
      }

      const { data: { session: recoverySession } } =
        await passwordRecoverySupabase.auth.getSession()
      await updatePasswordFromRecovery(password)
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
      setSuccess(true)
    } catch (err) {
      setError(err.message || '비밀번호 변경 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="phone-app-shell flex min-h-[100dvh] items-start justify-center overflow-hidden bg-white px-4 pt-[16vh]">
      <div className="w-full max-w-sm px-2">
        <div className="mb-8 min-h-[176px] pt-[54px] text-left">
          <h1 className="text-2xl font-semibold text-gray-900">새 비밀번호 설정</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            앞으로 사용할 새 비밀번호를 입력해주세요.
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <p className="text-center text-sm leading-relaxed text-green-600">
              비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.
            </p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="w-full rounded-full bg-orange-500 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
            >
              로그인으로 이동
            </button>
          </div>
        ) : !recoveryReady ? (
          <div className="space-y-4">
            <button type="button" onClick={() => navigate('/login')} className="w-full rounded-full bg-orange-500 py-3.5 text-sm font-semibold text-white">
              로그인으로 이동
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}

function ResetField({ label, children }) {
  return (
    <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2">
      <span className="text-xs font-normal leading-none text-gray-500">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full border-none bg-white p-0 text-sm text-gray-900 outline-none placeholder:text-transparent focus:outline-none'
