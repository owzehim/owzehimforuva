import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaretLeft } from '@phosphor-icons/react'
import { updatePassword } from '../api/authRepository'

const copy = {
  back: '\uC124\uC815\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30',
  title: '\uBE44\uBC00\uBC88\uD638 \uBC14\uAFB8\uAE30',
  description: '\uC0C8 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.',
  newPassword: '\uC0C8 \uBE44\uBC00\uBC88\uD638',
  confirmPassword: '\uC0C8 \uBE44\uBC00\uBC88\uD638 \uD655\uC778',
  tooShort: '\uBE44\uBC00\uBC88\uD638\uB294 \uCD5C\uC18C 8\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.',
  mismatch: '\uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.',
  success: '\uBE44\uBC00\uBC88\uD638\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.',
  error: '\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.',
  changing: '\uBCC0\uACBD \uC911...',
  submit: '\uBCC0\uACBD \uC644\uB8CC',
}

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (newPassword.length < 8) {
      setError(copy.tooShort)
      return
    }
    if (newPassword !== confirmPassword) {
      setError(copy.mismatch)
      return
    }

    setLoading(true)
    try {
      await updatePassword(newPassword)
      setSuccess(copy.success)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message || copy.error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="phone-app-shell scrollbar-hidden relative min-h-[100dvh] overflow-y-auto bg-white px-4 dark:bg-[#121212]">
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="absolute left-[14px] z-10 flex h-11 w-11 items-center justify-center text-[#374151] dark:text-[#c7c7cc]"
        style={{ top: 'max(18px, calc(env(safe-area-inset-top) + 6px))' }}
        aria-label={copy.back}
      >
        <CaretLeft size={24} weight="bold" />
      </button>

      <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm items-center px-2 py-8">
        <form onSubmit={handleSubmit} className="w-full -translate-y-[56px] space-y-4">
          <div className="mb-8 min-h-[176px] pt-[54px] text-left">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{copy.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{copy.description}</p>
          </div>

          <div className="relative -translate-y-9 space-y-4">
            <PasswordField label={copy.newPassword} value={newPassword} onChange={setNewPassword} />
            <PasswordField label={copy.confirmPassword} value={confirmPassword} onChange={setConfirmPassword} />

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm leading-relaxed text-green-600">{success}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full rounded-full bg-orange-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {loading ? copy.changing : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

function PasswordField({ label, value, onChange }) {
  return (
    <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-[#2c2c2e] dark:bg-[#111111]">
      <span className="text-xs font-normal leading-none text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border-none bg-white p-0 text-sm text-gray-900 outline-none placeholder:text-transparent focus:outline-none dark:bg-[#111111] dark:text-white"
        autoComplete="new-password"
        required
      />
    </label>
  )
}
