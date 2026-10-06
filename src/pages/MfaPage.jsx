import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'

export default function MfaPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [factorId, setFactorId] = useState('')
  const [qrUri, setQrUri] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      setLoading(true)
      setError('')
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!sessionData.session) {
          navigate('/login', { replace: true })
          return
        }

        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (assuranceError) throw assuranceError
        if (assurance?.currentLevel === 'aal2') {
          navigate(location.state?.from?.pathname || '/member', { replace: true })
          return
        }

        const { data: factorData, error: factorError } =
          await supabase.auth.mfa.listFactors()
        if (factorError) throw factorError

        const verifiedTotp = factorData?.totp?.find((factor) => factor.status === 'verified')
        if (verifiedTotp) {
          if (!cancelled) setFactorId(verifiedTotp.id)
          return
        }

        // Discard incomplete enrollment left by a closed browser, then create
        // a fresh QR so the secret is available only during this setup screen.
        for (const pendingFactor of factorData?.totp || []) {
          if (pendingFactor.status !== 'verified') {
            const { error: unenrollError } = await supabase.auth.mfa.unenroll({
              factorId: pendingFactor.id,
            })
            if (unenrollError) throw unenrollError
          }
        }

        const { data: enrollment, error: enrollmentError } =
          await supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'UvA-IN authenticator',
          })
        if (enrollmentError) throw enrollmentError
        if (!cancelled) {
          setFactorId(enrollment.id)
          setQrUri(enrollment.totp.uri)
          setSecret(enrollment.totp.secret)
        }
      } catch (initializationError) {
        if (!cancelled) {
          setError(initializationError.message || '2단계 인증을 준비하지 못했습니다.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialize()
    return () => { cancelled = true }
  }, [location.state, navigate])

  const handleVerify = async (event) => {
    event.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) {
      setError('인증 앱의 6자리 코드를 입력해 주세요.')
      return
    }
    setSubmitting(true)
    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      })
      if (verifyError) throw verifyError

      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) throw refreshError
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assuranceError) throw assuranceError
      if (assurance?.currentLevel !== 'aal2') {
        throw new Error('2단계 인증 완료 상태를 확인하지 못했습니다. 코드를 다시 입력해 주세요.')
      }

      navigate(location.state?.from?.pathname || '/member', { replace: true })
    } catch (verificationError) {
      setCode('')
      setError(verificationError.message || '인증에 실패했습니다. 코드를 다시 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: 'local' })
    navigate('/login', { replace: true })
  }

  return (
    <main className="min-h-[100dvh] bg-white px-5 py-10 text-gray-900 dark:bg-[#121212] dark:text-white">
      <section className="mx-auto flex min-h-[80dvh] w-full max-w-sm flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-semibold">계정 2단계 인증</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
          계정 보호를 위해 인증 앱으로 코드를 확인해 주세요.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-gray-500">인증 설정을 불러오는 중...</p>
        ) : error && !factorId ? (
          <div className="mt-8 w-full">
            <p className="text-sm text-red-500">{error}</p>
            <button type="button" onClick={handleSignOut} className="mt-6 text-sm text-orange-500">
              로그아웃하고 다시 시작
            </button>
          </div>
        ) : (
          <>
            {qrUri && (
              <div className="mt-8 rounded-xl bg-white p-4">
                <QRCodeSVG value={qrUri} size={208} includeMargin />
              </div>
            )}
            <p className="mt-5 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {qrUri
                ? 'Google Authenticator, Microsoft Authenticator 등 인증 앱에서 QR 코드를 스캔해 주세요.'
                : '인증 앱에 표시된 6자리 코드를 입력해 주세요.'}
            </p>
            {secret && (
              <details className="mt-3 w-full text-left text-xs text-gray-500">
                <summary className="cursor-pointer">QR 스캔이 안 되나요? 직접 입력</summary>
                <code className="mt-2 block break-all rounded bg-gray-100 p-2 dark:bg-gray-800">{secret}</code>
              </details>
            )}
            <form onSubmit={handleVerify} className="mt-6 w-full space-y-4">
              <label className="block text-left text-xs text-gray-500">
                인증 코드
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  required
                />
              </label>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className="w-full rounded-full bg-orange-500 py-3 font-semibold text-white disabled:opacity-50"
              >
                {submitting ? '확인 중...' : '인증하고 계속'}
              </button>
            </form>
          </>
        )}

        <button type="button" onClick={handleSignOut} className="mt-6 text-xs text-gray-400">
          로그아웃
        </button>
      </section>
    </main>
  )
}
