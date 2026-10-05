import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../api/authRepository'
import { isPasswordRecoveryClaims } from '../domain/auth/recovery'
import { supabase } from '../lib/supabase'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    let active = true
    const verifyRecoverySession = async () => {
      const { data, error } = await supabase.auth.getClaims()
      if (active) setRecoveryReady(!error && isPasswordRecoveryClaims(data?.claims))
    }
    void verifyRecoverySession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        void verifyRecoverySession()
      } else if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
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

    if (password.length < 12) {
      setError('비밀번호는 최소 12자 이상이어야 합니다.')
      return
    }

    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    try {
      const { data, error: claimsError } = await supabase.auth.getClaims()
      if (claimsError) throw claimsError
      if (!isPasswordRecoveryClaims(data?.claims)) {
        setRecoveryReady(false)
        throw new Error('이 화면은 비밀번호 재설정 이메일의 링크로만 사용할 수 있습니다.')
      }

      await updatePassword(password)
      const { error: otherSessionsError } = await supabase.auth.signOut({ scope: 'others' })
      const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (localSignOutError) throw localSignOutError
      if (otherSessionsError) console.error('Could not revoke other sessions after password reset')
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
            <p className="text-center text-sm leading-relaxed text-gray-500">
              비밀번호 재설정 이메일의 링크로 이 화면을 열어주세요.
            </p>
            <button type="button" onClick={() => navigate('/login')} className="w-full rounded-full bg-orange-500 py-3.5 text-sm font-semibold text-white">
              로그인으로 이동
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <ResetField label="새 비밀번호">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
              />
            </ResetField>

            <ResetField label="새 비밀번호 확인">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                required
              />
            </ResetField>

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
