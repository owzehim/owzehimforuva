import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, SpinnerGap } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

const copy = {
  verifyingTitle: '\uC774\uBA54\uC77C \uC778\uC99D \uC911',
  verifyingMessage: '\uC7A0\uC2DC\uB9CC \uAE30\uB2E4\uB824\uC8FC\uC138\uC694.',
  successTitle: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.',
  successMessage: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uACF5\uAC1C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.',
  errorTitle: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC2E4\uD328\uD558\uC600\uC2B5\uB2C8\uB2E4.',
  errorMessage: '\uC778\uC99D \uB9C1\uD06C\uAC00 \uB9CC\uB8CC\uB418\uC5C8\uAC70\uB098 \uC774\uBBF8 \uC0AC\uC6A9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n\uC0C8 \uC778\uC99D \uB9C1\uD06C\uB97C \uC694\uCCAD\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.',
}

const CONFIRMATION_EVENT_KEY = 'uvain-email-confirmation-result'

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
  const [status, setStatus] = useState('verifying')

  const finish = useCallback((nextStatus) => {
    announceConfirmationFinished(nextStatus)
    setStatus(nextStatus)
  }, [])

  useEffect(() => {
    let cancelled = false

    const verifyEmail = async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const result = code
          ? await supabase.auth.exchangeCodeForSession(code)
          : await supabase.auth.getSession()

        if (cancelled) return

        if (result.error || !result.data?.session) {
          finish('error')
          return
        }

        if (result.data.session.user?.user_metadata?.registration) {
          const { data: registrationResult, error: registrationError } =
            await supabase.functions.invoke('complete-member-registration')

          if (registrationError || !registrationResult?.success) {
            console.error(
              'Email was confirmed, but member registration could not be completed:',
              registrationError || registrationResult?.message,
            )
            await supabase.auth.signOut()
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
            await supabase.auth.signOut()
            if (!cancelled) finish('email_change_error')
            return
          }
        }

        await supabase.auth.signOut()
        if (!cancelled) finish('success')
      } catch {
        if (!cancelled) finish('error')
      }
    }

    verifyEmail()
    return () => { cancelled = true }
  }, [finish])

  useEffect(() => {
    if (status === 'verifying') return undefined
    const timeout = window.setTimeout(() => {
      navigate('/public', { replace: true })
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [status, navigate])

  const isVerifying = status === 'verifying'
  const isSuccess = status === 'success'
  const title = isVerifying
    ? copy.verifyingTitle
    : isSuccess
      ? copy.successTitle
      : status === 'registration_error'
        ? '이메일 인증은 완료됐지만 회원가입 저장에 실패했습니다.'
        : status === 'email_change_error'
          ? '이메일 인증은 완료됐지만 계정 이메일 변경 마무리에 실패했습니다.'
        : copy.errorTitle
  const message = isVerifying
    ? copy.verifyingMessage
    : isSuccess
      ? copy.successMessage
      : status === 'registration_error'
        ? '로그인하면 회원가입 저장을 다시 시도합니다. 문제가 계속되면 지원팀에 문의해주세요.'
        : status === 'email_change_error'
          ? '이 페이지를 새로고침해 다시 시도해주세요. 문제가 계속되면 지원팀에 문의해주세요.'
        : copy.errorMessage

  return (
    <div className="phone-app-shell" style={styles.page}>
      <div style={styles.panel}>
        {isVerifying ? (
          <SpinnerGap size={54} weight="bold" color="#f97316" style={styles.spinnerIcon} />
        ) : isSuccess ? (
          <CheckCircle size={64} weight="fill" color="#f97316" />
        ) : (
          <XCircle size={64} weight="fill" color="#ef4444" />
        )}
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.message}>{message}</p>
        {!isVerifying && (
          <button
            type="button"
            onClick={() => navigate('/public', { replace: true })}
            style={styles.returnButton}
          >
            {'공개 페이지로 돌아가기'}
          </button>
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
    borderRadius: '14px',
    background: '#f97316',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
}
