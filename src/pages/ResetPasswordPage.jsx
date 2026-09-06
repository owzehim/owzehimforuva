import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../api/authRepository'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

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
      await updatePassword(password)
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
