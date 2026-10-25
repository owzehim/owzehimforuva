import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CaretLeft } from '@phosphor-icons/react'
import { LEGAL_DOCUMENT_VERSION, legalDocuments } from '../content/legalDocuments'
import ThirdPartyLicensesPage from './ThirdPartyLicensesPage'

const documentKeys = ['terms', 'privacy', 'community']

export default function LegalPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [language, setLanguage] = useState(searchParams.get('lang') === 'en' ? 'en' : 'ko')
  const [activeKey, setActiveKey] = useState('terms')
  const [showLicenses, setShowLicenses] = useState(false)
  const document = legalDocuments[activeKey]
  const content = language === 'ko' ? document.ko : document
  const closeLabel = language === 'ko' ? '뒤로' : 'Back'
  const documentLabels = useMemo(() => ({
    terms: language === 'ko' ? '이용약관' : 'Terms',
    privacy: language === 'ko' ? '개인정보' : 'Privacy',
    community: language === 'ko' ? '커뮤니티' : 'Community',
  }), [language])

  return (
    <main className="legal-page min-h-dvh bg-white text-gray-900 dark:bg-[#121212] dark:text-white">
      <header className="legal-page-controls sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-[#2c2c2e] dark:bg-[#121212]/95">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 items-center gap-1 rounded-full px-2 text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            <CaretLeft size={18} /> {closeLabel}
          </button>
          <button
            type="button"
            onClick={() => setLanguage((current) => current === 'ko' ? 'en' : 'ko')}
            className="rounded-full border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-700"
          >
            {language === 'ko' ? 'English' : '한국어'}
          </button>
        </div>
        <nav aria-label={language === 'ko' ? '법률 문서' : 'Legal documents'} className="mx-auto mt-3 flex max-w-3xl gap-2 overflow-x-auto">
          {documentKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveKey(key)
                setShowLicenses(false)
              }}
              aria-pressed={!showLicenses && activeKey === key}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${!showLicenses && activeKey === key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 dark:bg-[#242426] dark:text-gray-300'}`}
            >
              {documentLabels[key]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowLicenses(true)}
            className="shrink-0 rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"
          >
            {language === 'ko' ? '오픈소스 라이선스' : 'Open-source licenses'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto shrink-0 rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"
          >
            {language === 'ko' ? 'PDF 저장' : 'Save as PDF'}
          </button>
        </nav>
      </header>

      {showLicenses ? (
        <ThirdPartyLicensesPage embedded languageOverride={language} />
      ) : (
        <article id="legal-document-content" className="legal-document-content mx-auto max-w-3xl px-5 py-7 sm:px-8">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {language === 'ko' ? '문서 버전' : 'Document version'}: {LEGAL_DOCUMENT_VERSION}
          </p>
          <h1 className="mt-2 text-2xl font-bold">{content.title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {language === 'ko' ? '시행일' : 'Effective Date'}: {content.effectiveDate}
          </p>
          <div className="mt-6 space-y-3 text-sm leading-7 text-gray-700 dark:text-gray-200">
            {content.body.split('\n').map((line, index) => (
              <p key={`${activeKey}-${language}-${index}`} className={line.trim() ? '' : 'h-1'}>
                {line}
              </p>
            ))}
          </div>
        </article>
      )}
    </main>
  )
}
