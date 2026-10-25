import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CaretDown, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { LEGAL_DOCUMENT_VERSION, legalDocuments } from '../content/legalDocuments'

const DOCUMENT_KEYS = ['terms', 'privacy', 'community']

export default function LegalConsentPage({ onAccepted, onRetry, statusError = false }) {
  const navigate = useNavigate()
  const [language, setLanguage] = useState('ko')
  const [checked, setChecked] = useState({ terms: false, privacy: false, community: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const labels = useMemo(() => language === 'ko'
    ? {
        title: '이용 정책이 업데이트되었어요',
        subtitle: '계속 이용하려면 아래 최신 문서를 확인하고 동의해 주세요.',
        terms: '이용약관',
        privacy: '개인정보 처리방침',
        community: '커뮤니티 가이드라인',
        read: '전문 보기',
        agree: (name) => `${name}에 동의합니다`,
        submit: '동의하고 계속',
        retry: '다시 확인',
        loadError: '동의 상태를 확인하지 못했습니다. 다시 시도해 주세요.',
        saveError: '동의 내용을 저장하지 못했습니다. 다시 시도해 주세요.',
        working: '저장 중',
      }
    : {
        title: 'Our policies have been updated',
        subtitle: 'Please review and accept the latest documents to continue.',
        terms: 'Terms and Conditions',
        privacy: 'Privacy Policy',
        community: 'Community Guidelines',
        read: 'Read full text',
        agree: (name) => `I agree to the ${name}`,
        submit: 'Accept and continue',
        retry: 'Check again',
        loadError: 'We could not check your consent status. Please try again.',
        saveError: 'We could not save your consent. Please try again.',
        working: 'Saving',
      }, [language])
  const allChecked = DOCUMENT_KEYS.every((key) => checked[key])

  const toggle = (key) => setChecked((current) => ({ ...current, [key]: !current[key] }))

  const accept = async () => {
    if (!allChecked || submitting) return
    setSubmitting(true)
    setError('')
    let data
    let invokeError
    try {
      ({ data, error: invokeError } = await supabase.functions.invoke('manage-legal-consent', {
        body: { action: 'accept', documentKeys: DOCUMENT_KEYS },
      }))
    } catch (requestError) {
      invokeError = requestError
    }
    setSubmitting(false)
    if (invokeError || data?.success !== true) {
      setError(labels.saveError)
      return
    }
    onAccepted()
    navigate('/member', { replace: true })
  }

  const names = { terms: labels.terms, privacy: labels.privacy, community: labels.community }

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-8 text-gray-900 dark:bg-[#121212] dark:text-white">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-5 shadow-sm dark:bg-[#1c1c1e] sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{labels.title}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setLanguage((current) => current === 'ko' ? 'en' : 'ko')}
            className="shrink-0 rounded-full border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-700"
          >
            {language === 'ko' ? 'English' : '한국어'}
          </button>
        </div>

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {language === 'ko' ? '문서 버전' : 'Document version'}: {LEGAL_DOCUMENT_VERSION}
        </p>

        {statusError ? (
          <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            <p>{labels.loadError}</p>
            <button type="button" onClick={onRetry} className="mt-3 font-semibold underline">{labels.retry}</button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {DOCUMENT_KEYS.map((key) => {
              const document = legalDocuments[key]
              const content = language === 'ko' ? document.ko : document
              return (
                <section key={key} className="rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3 p-4">
                    <input
                      id={`consent-${key}`}
                      type="checkbox"
                      checked={checked[key]}
                      onChange={() => toggle(key)}
                      className="h-5 w-5 shrink-0 accent-orange-500"
                    />
                    <label htmlFor={`consent-${key}`} className="flex-1 text-sm font-semibold">
                      {labels.agree(names[key])}
                    </label>
                    <CaretDown size={17} className="text-gray-400" aria-hidden="true" />
                  </div>
                  <details className="border-t border-gray-100 dark:border-gray-700">
                    <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-orange-600 dark:text-orange-400">
                      {labels.read}: {names[key]}
                    </summary>
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-gray-100 px-4 py-3 text-xs leading-6 text-gray-600 dark:border-gray-700 dark:text-gray-300">
                      <h2 className="mb-1 font-bold text-gray-900 dark:text-white">{content.title}</h2>
                      <p className="mb-2">{language === 'ko' ? '시행일' : 'Effective Date'}: {content.effectiveDate}</p>
                      {content.body}
                    </div>
                  </details>
                </section>
              )
            })}
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

        <button
          type="button"
          disabled={!allChecked || submitting || statusError}
          onClick={accept}
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
        >
          {submitting ? <><CircleNotch size={18} className="animate-spin" />{labels.working}</> : <><Check size={18} />{labels.submit}</>}
        </button>

        <button type="button" onClick={async () => { await supabase.auth.signOut(); navigate('/login', { replace: true }) }} className="mt-4 w-full py-2 text-sm font-medium text-gray-500">
          {language === 'ko' ? '로그아웃하고 나중에 하기' : 'Sign out and do this later'}
        </button>
      </section>
    </main>
  )
}
