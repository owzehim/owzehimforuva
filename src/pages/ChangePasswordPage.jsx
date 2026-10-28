import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaretLeft, Eye, EyeSlash } from '@phosphor-icons/react'
import { updatePassword } from '../api/authRepository'
import CaptchaChallenge from '../components/CaptchaChallenge'
import { isCaptchaEnabled } from '../lib/captcha'

const copy = {
  back: '\uC124\uC815\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30',
  title: '\uBE44\uBC00\uBC88\uD638 \uBC14\uAFB8\uAE30',
  description: '\uD604\uC7AC \uBE44\uBC00\uBC88\uD638\uC640 \uC0C8 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.',
  newPassword: '\uC0C8 \uBE44\uBC00\uBC88\uD638',
  currentPassword: '\uD604\uC7AC \uBE44\uBC00\uBC88\uD638',
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
  const [currentPassword, setCurrentPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const resetCaptcha = () => {
    setCaptchaToken('')
    setCaptchaResetKey((key) => key + 1)
  }

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
      await updatePassword(newPassword, currentPassword, captchaToken)
      setSuccess(copy.success)
      setNewPassword('')
      setCurrentPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message || copy.error)
    } finally {
      setLoading(false)
      if (isCaptchaEnabled) resetCaptcha()
    }
  }

  return (
    <main className="phone-app-shell settings-password-page scrollbar-hidden relative min-h-[100dvh] overflow-y-auto bg-white px-4 dark:bg-[#121212]">
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="settings-password-back fixed left-[14px] z-10 flex h-11 w-11 items-center justify-center text-[#374151] dark:text-[#c7c7cc]"
        style={{ top: 'calc(env(safe-area-inset-top) + 6px)' }}
        aria-label={copy.back}
      >
        <CaretLeft size={24} weight="bold" />
      </button>

      <div className="settings-password-content mx-auto flex min-h-[100dvh] w-full max-w-sm items-center px-2 py-8">
        <form onSubmit={handleSubmit} className="settings-password-form w-full -translate-y-[56px] space-y-4">
          <div className="settings-password-heading mb-8 min-h-[176px] pt-[54px] text-left">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{copy.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{copy.description}</p>
          </div>

          <div className="settings-password-fields relative -translate-y-9 space-y-4">
            <PasswordField label={copy.currentPassword} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <PasswordField label={copy.newPassword} value={newPassword} onChange={setNewPassword} />
            <PasswordField label={copy.confirmPassword} value={confirmPassword} onChange={setConfirmPassword} />

            <CaptchaChallenge onVerify={setCaptchaToken} resetKey={captchaResetKey} />

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm leading-relaxed text-green-600">{success}</p>}

            <button
              type="submit"
              disabled={loading || (isCaptchaEnabled && !captchaToken)}
              className="settings-password-submit mt-5 w-full rounded-full bg-orange-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {loading ? copy.changing : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

function PasswordField({ label, value, onChange, autoComplete = 'new-password' }) {
  const [visible, setVisible] = useState(false)
  const isSecret = autoComplete !== 'one-time-code'

  return (
    <div className="flex h-[54px] items-center rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600 dark:border-[#2c2c2e] dark:bg-[#111111]">
      <label className="flex min-w-0 flex-1 cursor-text flex-col justify-center gap-1">
        <span className="text-xs font-normal leading-none text-gray-500 dark:text-gray-400">{label}</span>
        <input
          type={isSecret && !visible ? 'password' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full border-none bg-white p-0 pr-2 text-sm text-gray-900 outline-none placeholder:text-transparent focus:outline-none dark:bg-[#111111] dark:text-white"
          autoComplete={autoComplete}
          required
        />
      </label>
      {isSecret && (
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 표시'}
          className="ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-500 dark:text-gray-400"
        >
          {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  )
}
