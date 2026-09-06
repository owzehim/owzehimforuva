import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, SpinnerGap } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

const copy = {
  verifyingTitle: '\uC774\uBA54\uC77C \uC778\uC99D \uC911',
  verifyingMessage: '\uC7A0\uC2DC\uB9CC \uAE30\uB2E4\uB824\uC8FC\uC138\uC694.',
  successTitle: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.',
  successMessage: 'UvA-IN \uC571\uC73C\uB85C \uB3CC\uC544\uAC00 \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.',
  errorTitle: '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC2E4\uD328\uD558\uC600\uC2B5\uB2C8\uB2E4.',
  errorMessage: '\uC778\uC99D \uB9C1\uD06C\uAC00 \uB9CC\uB8CC\uB418\uC5C8\uAC70\uB098 \uC774\uBBF8 \uC0AC\uC6A9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n\uC0C8 \uC778\uC99D \uB9C1\uD06C\uB97C \uC694\uCCAD\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.',
}

export default function EmailConfirmedPage() {
  const [status, setStatus] = useState('verifying')

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
          setStatus('error')
          return
        }

        const verifiedEmail = result.data.session.user?.email?.trim().toLowerCase()
        if (verifiedEmail) {
          window.localStorage.setItem('uvain_skip_otp_once_email', verifiedEmail)
        }
        await supabase.auth.signOut()
        if (!cancelled) setStatus('success')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    verifyEmail()
    return () => { cancelled = true }
  }, [])

  const isVerifying = status === 'verifying'
  const isSuccess = status === 'success'
  const title = isVerifying
    ? copy.verifyingTitle
    : isSuccess
      ? copy.successTitle
      : copy.errorTitle
  const message = isVerifying
    ? copy.verifyingMessage
    : isSuccess
      ? copy.successMessage
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
}
