import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaretLeft, Eye, EyeSlash } from '@phosphor-icons/react'
import { useLogin } from '../hooks/useLogin'
import CaptchaChallenge from '../components/CaptchaChallenge'
import { isCaptchaEnabled } from '../lib/captcha'

const KEYBOARD_CLOSE_DELAY_MS = 360

export default function LoginPage() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const otpRequestStartedRef = useRef(false)
  const {
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
    handleCredentialsSubmit,
    handleOtpSubmit,
    handleRequestOtp,
    handleResendOtp,
    handleResendConfirmation,
    handleForgotPassword,
    handlePasswordResetSubmit,
    handleBack,
  } = useLogin()

  const isStandaloneStep = step === 'otp' || step === 'forgot'
  const resetCaptcha = () => {
    setCaptchaToken('')
    setCaptchaResetKey((key) => key + 1)
  }
  const handleRequestOtpRef = useRef(handleRequestOtp)
  useEffect(() => {
    handleRequestOtpRef.current = handleRequestOtp
  }, [handleRequestOtp])

  useEffect(() => {
    if (step !== 'otp') {
      otpRequestStartedRef.current = false
      return
    }
    if (otpSent || loading || (isCaptchaEnabled && !captchaToken) || otpRequestStartedRef.current) return

    otpRequestStartedRef.current = true
    const token = captchaToken
    void (async () => {
      try {
        await handleRequestOtpRef.current(token)
      } finally {
        otpRequestStartedRef.current = false
        if (isCaptchaEnabled) {
          setCaptchaToken('')
          setCaptchaResetKey((key) => key + 1)
        }
      }
    })()
  }, [step, otpSent, loading, captchaToken])
  const submitCredentials = async (event) => {
    try {
      await handleCredentialsSubmit(event, captchaToken)
    } finally {
      if (isCaptchaEnabled) resetCaptcha()
    }
  }
  const submitPasswordReset = async (event) => {
    try {
      await handlePasswordResetSubmit(event, captchaToken)
    } finally {
      if (isCaptchaEnabled) resetCaptcha()
    }
  }
  const resendLoginOtp = async () => {
    try {
      await handleResendOtp(captchaToken)
    } finally {
      if (isCaptchaEnabled) resetCaptcha()
    }
  }
  const resendConfirmation = async () => {
    try {
      await handleResendConfirmation(captchaToken)
    } finally {
      if (isCaptchaEnabled) resetCaptcha()
    }
  }

  const closeLogin = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    window.setTimeout(() => {
      window.scrollTo(0, 0)
      navigate('/public', { replace: true })
    }, KEYBOARD_CLOSE_DELAY_MS)
  }

  return (
    <main
      className="phone-app-shell login-page scrollbar-hidden relative min-h-[100dvh] overflow-y-auto bg-white px-4 dark:bg-[#121212]"
      onDragStart={(event) => event.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}
    >
      <button
        type="button"
        onClick={isStandaloneStep ? handleBack : closeLogin}
        className="absolute left-[14px] z-10 flex h-11 w-11 items-center justify-center text-[#374151] dark:text-[#c7c7cc]"
        style={{ top: 'max(18px, calc(env(safe-area-inset-top) + 6px))' }}
        aria-label={isStandaloneStep ? 'Back to login' : 'Close login'}
      >
        <CaretLeft size={24} weight="bold" />
      </button>

      <div
        className="mx-auto flex min-h-[100dvh] w-full max-w-sm items-center px-2 py-8"
      >
        <div
          className="w-full"
          style={{
            transform: step === 'credentials' ? 'translateY(-28px)' : undefined,
          }}
        >
          {!isStandaloneStep && (
            <>
              <div className="mb-3 flex justify-center">
                <img
                  src="/UvA-IN-logo-transparent.png"
                  alt="UvA-IN Logo"
                  draggable={false}
                  className="h-24 w-24 object-contain"
                />
              </div>

              <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">UvA-IN</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  네덜란드 유학생을 위한 커뮤니티
                </p>
              </div>
            </>
          )}

          {step === 'credentials' && (
            <form onSubmit={submitCredentials} className="space-y-3">
              <LoginField label="이메일">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder=""
                  autoComplete="email"
                  required
                />
              </LoginField>

              <div className="relative">
                <LoginField label="비밀번호">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-9`}
                    placeholder=""
                    autoComplete="current-password"
                    required
                  />
                </LoginField>
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-gray-500 dark:text-gray-400"
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-medium text-gray-400 hover:text-orange-500 dark:text-gray-500 dark:hover:text-orange-400"
                >
                  비밀번호를 잊으셨나요?
                </button>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <CaptchaChallenge onVerify={setCaptchaToken} resetKey={captchaResetKey} />

              <button
                type="submit"
                disabled={loading || (isCaptchaEnabled && !captchaToken)}
                className="mt-5 w-full rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? '확인 중...' : '로그인'}
              </button>

              <p className="pt-2 text-center text-xs text-gray-400 dark:text-gray-500">
                계정이 없으신가요?{' '}
                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className="font-medium text-orange-500 hover:underline"
                >
                  회원가입
                </button>
              </p>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={submitPasswordReset} className="relative -translate-y-[56px] space-y-4">
              <div className="mb-8 min-h-[176px] pt-[54px] text-left">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">비밀번호 재설정</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  가입한 이메일을 입력하면 새 비밀번호를 설정할 수 있는 링크를 보내드립니다.
                </p>
              </div>

              <LoginField label="이메일">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder=""
                  autoComplete="email"
                  required
                />
              </LoginField>

              {error && <p className="text-sm text-red-500">{error}</p>}
              {resetSuccess && (
                <p className="text-sm leading-relaxed text-green-600">
                  비밀번호 재설정 링크를 이메일로 보냈습니다.
                </p>
              )}

              <CaptchaChallenge onVerify={setCaptchaToken} resetKey={captchaResetKey} />

              <button
                type="submit"
                disabled={loading || (isCaptchaEnabled && !captchaToken)}
                className="mt-5 w-full rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? '전송 중...' : '재설정 링크 보내기'}
              </button>

              <button
                type="button"
                onClick={handleBack}
                className="w-full pt-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                로그인으로 돌아가기
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div className="mb-8 min-h-[176px] pt-[54px] text-left">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">이메일 인증 코드</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-white">{email}</span>
                </p>
              </div>

              <LoginField label="인증 코드">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className={`${inputClass} text-center font-mono text-base tracking-[0.35em]`}
                  placeholder=""
                  autoComplete="one-time-code"
                  required
                />
              </LoginField>

              {error && <p className="text-center text-sm text-red-500">{error}</p>}
              {resendSuccess && (
                <p className="text-center text-sm text-green-600">
                  인증 코드를 다시 보냈습니다.
                </p>
              )}

              <CaptchaChallenge onVerify={setCaptchaToken} resetKey={captchaResetKey} />

              <button
                type="submit"
                disabled={loading || !otpSent || otp.length !== 6}
                className="mt-6 w-full rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                인증 완료하기
              </button>

              {otpSent && <button
                type="button"
                onClick={resendLoginOtp}
                disabled={loading || (isCaptchaEnabled && !captchaToken)}
                className="w-full pt-1 text-center text-xs font-medium text-orange-500 hover:underline disabled:opacity-50"
              >
                코드 다시 보내기
              </button>}
            </form>
          )}

          {step === 'unconfirmed' && (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">이메일 확인이 필요합니다</h2>
              <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-900 dark:text-white">{email}</span>로 보낸<br />
                인증 링크를 열고 다시 로그인해주세요.
              </p>

              {error && <p className="text-sm text-red-500">{error}</p>}
              {resendSuccess && (
                <p className="text-sm text-green-600">인증 이메일을 다시 보냈습니다.</p>
              )}

              <CaptchaChallenge onVerify={setCaptchaToken} resetKey={captchaResetKey} />

              <button
                type="button"
                onClick={resendConfirmation}
                disabled={loading || (isCaptchaEnabled && !captchaToken)}
                className="w-full rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? '전송 중...' : '인증 이메일 다시 보내기'}
              </button>

              <button
                type="button"
                onClick={handleBack}
                className="w-full pt-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                뒤로
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function LoginField({ label, children }) {
  return (
    <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-[#2c2c2e] dark:bg-[#111111]">
      <span className="text-xs font-normal leading-none text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full border-none bg-white p-0 text-sm text-gray-900 outline-none placeholder:text-transparent focus:outline-none dark:bg-[#111111] dark:text-white'
