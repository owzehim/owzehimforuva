import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, SpinnerGap } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { resendConfirmationEmail } from '../api/authRepository'
import CaptchaChallenge from '../components/CaptchaChallenge'
import DevelopmentCaptchaPreview from '../components/DevelopmentCaptchaPreview'
import { isCaptchaEnabled } from '../lib/captcha'
import { hasAppAccessClaim } from '../domain/auth/authRules'

const copy = {
  verifyingTitle: '\uC774\uBA54\uC77C \uC778\uC99D \uC911',
  verifyingMessage: '\uC7A0\uC2DC\uB9CC \uAE30\uB2E4\uB824\uC8FC\uC138\uC694.',
  successTitle: '인증이 완료되었습니다',
  successMessage: '앱에서 로그인을 진행해 주세요',
  successTitleEn: 'Email verification is complete',
  successMessageEn: 'Please log in in the app',
  errorTitle: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC2E4\uD328\uD558\uC600\uC2B5\uB2C8\uB2E4.',
  errorMessage: '\uC778\uC99D \uB9C1\uD06C\uAC00 \uB9CC\uB8CC\uB418\uC5C8\uAC70\uB098 \uC774\uBBF8 \uC0AC\uC6A9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n\uC0C8 \uC778\uC99D \uB9C1\uD06C\uB97C \uC694\uCCAD\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.',
}

const CONFIRMATION_EVENT_KEY = 'uvain-email-confirmation-result'
const PREVIEW_STATUSES = new Set([
  'verifying',
  'success',
  'error',
  'registration_error',
  'email_change_error',
  'resend_success',
  'resend_error',
])

function announceConfirmationFinished(status) {
  try {
    window.localStorage.setItem(
      CONFIRMATION_EVENT_KEY,
      JSON.stringify({ status, at: Date.now() }),
    )
  } catch {
    // The callback page still redirects itself if browser storage is disabled.
  }
}

export default function EmailConfirmedPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedPreview = import.meta.env.DEV ? searchParams.get('preview') : null
  const previewStatus = PREVIEW_STATUSES.has(requestedPreview) ? requestedPreview : null
  const isPreviewMode = previewStatus !== null
  const [status, setStatus] = useState('verifying')
  const [email, setEmail] = useState(() => isPreviewMode ? 'preview@uva.example' : '')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState('')
  const [resendError, setResendError] = useState('')

  const finish = useCallback((nextStatus) => {
    announceConfirmationFinished(nextStatus)
    setStatus(nextStatus)
  }, [])

  useEffect(() => {
    if (isPreviewMode) return undefined
    let cancelled = false

    const verifyEmail = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const cameFromVerifiedLink = params.has('code')

        // Supabase's URL detection processes the existing PKCE link during
        // client startup. Read its session instead of exchanging the code twice.
        const result = await supabase.auth.getSession()
        if (result.error && !cameFromVerifiedLink) throw result.error
        const session = result.data?.session || null

        if (cancelled) return

        // Do not treat an already-authenticated app session as an email-link
        // session when a supplied app token was deliberately ignored above.
        if (hasAppAccessClaim(session?.access_token)) {
          finish('error')
          return
        }

        if (!session) {
          if (cameFromVerifiedLink) {
            // Supabase only redirects here with a code after confirming the
            // email. A different browser has no PKCE verifier to create a
            // session, so the user can finish the pending registration by logging in.
            window.history.replaceState({}, document.title, window.location.pathname)
            finish('success')
          } else {
            finish('error')
          }
          return
        }

        if (session.user?.user_metadata?.registration) {
          const { data: registrationResult, error: registrationError } =
            await supabase.functions.invoke('complete-member-registration')

          if (registrationError || !registrationResult?.success) {
            console.error(
              'Email was confirmed, but member registration could not be completed:',
              registrationError || registrationResult?.message,
            )
            await supabase.auth.signOut({ scope: 'local' })
            if (!cancelled) finish('registration_error')
            return
          }
        } else {
          const { data: emailChangeResult, error: emailChangeError } =
            await supabase.functions.invoke('finalize-pending-email')
          if (emailChangeError || !emailChangeResult?.success) {
            console.error(
              'Email was confirmed, but the pending email change could not be finalized:',
              emailChangeError || emailChangeResult?.message,
            )
            await supabase.auth.signOut({ scope: 'local' })
            if (!cancelled) finish('email_change_error')
            return
          }
        }

        await supabase.auth.signOut({ scope: 'local' })
        if (!cancelled) finish('success')
      } catch {
        if (!cancelled) finish('error')
      }
    }

    verifyEmail()
    return () => { cancelled = true }
  }, [finish, isPreviewMode])

  const visibleStatus = previewStatus === 'resend_success' || previewStatus === 'resend_error'
    ? 'error'
    : previewStatus || status
  const isVerifying = visibleStatus === 'verifying'
  const isSuccess = visibleStatus === 'success'
  const isError = !isVerifying && !isSuccess
  const isRegistrationError = visibleStatus === 'registration_error'
  const isEmailChangeError = visibleStatus === 'email_change_error'
  const isEnglish = navigator.language?.toLowerCase().startsWith('en')
  const title = isVerifying
    ? copy.verifyingTitle
    : isSuccess
      ? (isEnglish ? copy.successTitleEn : copy.successTitle)
      : visibleStatus === 'registration_error'
        ? '이메일 인증은 완료되었으나, 회원 정보 등록에 실패했습니다'
        : visibleStatus === 'email_change_error'
          ? '이메일 인증은 완료되었지만, 이메일 주소를 변경하지 못했어요.'
        : copy.errorTitle
  const message = isVerifying
    ? copy.verifyingMessage
    : isSuccess
      ? (isEnglish ? copy.successMessageEn : copy.successMessage)
      : visibleStatus === 'registration_error'
        ? '로그인해 주시면 가입 절차를 다시 시도합니다. 문제가 지속되면 지원팀으로 문의해 주세요.'
        : visibleStatus === 'email_change_error'
          ? '페이지를 새로고침해 다시 시도해 주세요. 문제가 계속되면 지원팀에 문의해 주세요.'
        : copy.errorMessage

  return (
    <div className="phone-app-shell email-confirmed-page" style={styles.page}>
      <div className={`email-confirmed-panel${isError ? ' email-confirmed-error' : ''}`} style={styles.panel}>
        <div className="email-confirmed-info">
          {isVerifying ? (
            <SpinnerGap size={54} weight="bold" color="#f97316" style={styles.spinnerIcon} />
          ) : isSuccess || isRegistrationError || isEmailChangeError ? (
            <CheckCircle size={64} weight="fill" color="#f97316" />
          ) : (
            <XCircle size={64} weight="fill" color="#ef4444" />
          )}
          <h1 style={styles.title}>{title}</h1>
          <p style={styles.message}>{message}</p>
          {isError && !isRegistrationError && !isEmailChangeError && (
            <div className="email-confirmed-left-fields">
              <div className="registration-field email-confirmed-email-field">
                <label htmlFor="confirmation-email" style={styles.emailFieldLabel}>
                  {isEnglish ? 'Email *' : '이메일 *'}
                </label>
                <input
                  id="confirmation-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder=""
                  style={styles.emailInput}
                />
              </div>
              {(isCaptchaEnabled || isPreviewMode) && (
                isPreviewMode ? (
                  <DevelopmentCaptchaPreview language={isEnglish ? 'en' : 'ko'} />
                ) : (
                  <CaptchaChallenge
                    onVerify={setCaptchaToken}
                    resetKey={captchaResetKey}
                  />
                )
              )}
            </div>
          )}
        </div>
        {isSuccess && (
          <button
            type="button"
            onClick={() => navigate('/public', { replace: true })}
            style={{ ...styles.returnButton, borderRadius: '9999px' }}
          >
            {isEnglish ? 'Return to homepage' : '홈 화면으로 이동'}
          </button>
        )}
        {isRegistrationError && (
          <div className="email-confirmed-actions" style={styles.actions}>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              style={styles.returnButton}
            >
              로그인하기
            </button>
            <button
              type="button"
              onClick={() => navigate('/public', { replace: true })}
              style={styles.secondaryButton}
            >
              홈 화면으로 이동
            </button>
          </div>
        )}
        {isEmailChangeError && (
          <div className="email-confirmed-actions" style={styles.actions}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={styles.returnButton}
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => navigate('/public', { replace: true })}
              style={styles.secondaryButton}
            >
              홈 화면으로 이동
            </button>
          </div>
        )}
        {isError && !isRegistrationError && !isEmailChangeError && (
          <div className="email-confirmed-actions" style={styles.actions}>
            {(resendMessage || previewStatus === 'resend_success') && (
              <p style={styles.successMessage}>{resendMessage || '인증 이메일을 다시 보냈습니다.'}</p>
            )}
            {(resendError || previewStatus === 'resend_error') && (
              <p style={styles.errorMessage}>{resendError || '인증 이메일을 다시 보내지 못했습니다. 잠시 후 다시 시도해주세요.'}</p>
            )}
            <button
              type="button"
              disabled={resending || (!email.trim() && !isPreviewMode) || (isCaptchaEnabled && !captchaToken && !isPreviewMode)}
              onClick={async () => {
                if (isPreviewMode) return
                setResending(true)
                setResendMessage('')
                setResendError('')
                try {
                  await resendConfirmationEmail(email, captchaToken)
                  setResendMessage('인증 이메일을 다시 보냈습니다.')
                } catch (error) {
                  setResendError(error.message || '인증 이메일을 다시 보내지 못했습니다.')
                } finally {
                  setResending(false)
                  if (isCaptchaEnabled) {
                    setCaptchaToken('')
                    setCaptchaResetKey((key) => key + 1)
                  }
                }
              }}
              style={{ ...styles.returnButton, opacity: resending || (!email.trim() && !isPreviewMode) || (isCaptchaEnabled && !captchaToken && !isPreviewMode) ? 0.55 : 1 }}
            >
              {resending ? '전송 중...' : '인증 이메일 다시 보내기'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/public', { replace: true })}
              style={styles.secondaryButton}
            >
              홈 화면으로 이동
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    fontFamily: 'var(--font-app)',
    padding: '24px 16px',
    boxSizing: 'border-box',
  },
  panel: {
    width: '100%',
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '14px',
  },
  title: {
    margin: '8px 0 0',
    fontSize: '24px',
    lineHeight: 1.25,
    fontWeight: 700,
    color: '#111827',
  },
  message: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1.65,
    color: '#6b7280',
    whiteSpace: 'pre-line',
  },
  spinnerIcon: {
    animation: 'spin 0.8s linear infinite',
  },
  returnButton: {
    width: '100%',
    marginTop: '8px',
    padding: '13px 18px',
    border: 0,
    borderRadius: '9999px',
    background: '#f97316',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  actions: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '8px',
  },
  emailLabel: {
    alignSelf: 'flex-start',
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
  },
  emailFieldLabel: {
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: '12px',
    textAlign: 'left',
    color: 'var(--reg-muted, #6b7280)',
  },
  emailInput: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '18px',
    padding: 0,
    border: 0,
    borderRadius: 0,
    outline: 'none',
    backgroundColor: 'var(--reg-field-bg)',
    fontSize: '16px',
    lineHeight: '18px',
    color: 'var(--reg-text, #111827)',
  },
  secondaryButton: {
    width: '100%',
    padding: '12px 18px',
    border: 0,
    borderRadius: '9999px',
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  successMessage: { margin: 0, color: '#15803d', fontSize: '13px' },
  errorMessage: { margin: 0, color: '#dc2626', fontSize: '13px' },
}
