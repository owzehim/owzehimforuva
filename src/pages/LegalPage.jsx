import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CaretLeft } from '@phosphor-icons/react'
import { LEGAL_DOCUMENT_VERSION, legalDocuments } from '../content/legalDocuments'
import ThirdPartyLicensesPage from './ThirdPartyLicensesPage'
import { LEGAL_ARCHIVE, loadArchivedLegalVersion } from '../content/legalArchiveIndex'

const documentKeys = ['terms', 'privacy', 'community']

export default function LegalPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [language, setLanguage] = useState(searchParams.get('lang') === 'en' ? 'en' : 'ko')
  const [activeKey, setActiveKey] = useState('terms')
  const [showLicenses, setShowLicenses] = useState(false)
  // LEG-05: earlier versions. null = current documents.
  const [showArchiveList, setShowArchiveList] = useState(false)
  const [archiveVersion, setArchiveVersion] = useState(null)
  const [archive, setArchive] = useState(null)
  const [archiveError, setArchiveError] = useState(false)

  useEffect(() => {
    if (!archiveVersion) return undefined
    let active = true
    loadArchivedLegalVersion(archiveVersion)
      .then((data) => {
        if (!active) return
        setArchive(data)
        setArchiveError(!data)
      })
      .catch(() => {
        if (active) setArchiveError(true)
      })
    return () => { active = false }
  }, [archiveVersion])

  const viewingArchive = Boolean(archiveVersion && archive?.version === archiveVersion)
  const document = viewingArchive ? archive.documents[activeKey] : legalDocuments[activeKey]
  // The oldest archived version exists in English only.
  const koreanMissing = language === 'ko' && !document.ko
  const content = language === 'ko' && document.ko ? document.ko : document
  const backToCurrent = () => {
    setArchiveVersion(null)
    setArchive(null)
    setArchiveError(false)
  }
  const closeLabel = language === 'ko' ? '뒤로' : 'Back'
  const documentLabels = useMemo(() => ({
    terms: language === 'ko' ? '이용약관' : 'Terms',
    privacy: language === 'ko' ? '개인정보' : 'Privacy',
    community: language === 'ko' ? '커뮤니티' : 'Community',
  }), [language])

  return (
    <main
      className="legal-page min-h-dvh bg-white text-gray-900 dark:bg-[#121212] dark:text-white"
      onDragStart={(event) => event.preventDefault()}
      style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
    >
      <header className="legal-page-controls sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 pb-3 backdrop-blur dark:border-[#2c2c2e] dark:bg-[#121212]/95">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="fixed left-[14px] z-20 flex h-11 w-11 items-center justify-center text-[#374151] dark:text-[#c7c7cc]"
          style={{ top: 'calc(env(safe-area-inset-top) + 6px)' }}
          aria-label={closeLabel}
        >
          <CaretLeft size={24} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => setLanguage((current) => current === 'ko' ? 'en' : 'ko')}
          className="fixed right-8 z-20 flex h-9 min-w-[72px] items-center justify-center rounded-full border border-gray-200 bg-white px-3 text-[13px] font-semibold text-[#374151] dark:border-[#2c2c2e] dark:bg-[#121212] dark:text-[#c7c7cc]"
          style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}
        >
          {language === 'ko' ? 'English' : '한국어'}
        </button>
        <div className="mx-auto max-w-3xl" style={{ height: 'calc(env(safe-area-inset-top) + 56px)' }} />
        <nav
          aria-label={language === 'ko' ? '법률 문서' : 'Legal documents'}
          className="scrollbar-hidden mx-auto flex max-w-3xl gap-2 overflow-x-auto"
          style={{ marginTop: 'calc(16px - max(0px, calc(12px - env(safe-area-inset-top))))' }}
        >
          {documentKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveKey(key)
                setShowLicenses(false)
                setShowArchiveList(false)
              }}
              aria-pressed={!showLicenses && !showArchiveList && activeKey === key}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${!showLicenses && !showArchiveList && activeKey === key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 dark:bg-[#242426] dark:text-gray-300'}`}
            >
              {documentLabels[key]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowLicenses(true)
              setShowArchiveList(false)
            }}
            aria-pressed={showLicenses}
            className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${showLicenses ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
          >
            {language === 'ko' ? '오픈소스 라이선스' : 'Open-source licenses'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowArchiveList(true)
              setShowLicenses(false)
            }}
            aria-pressed={showArchiveList}
            className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${showArchiveList ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
          >
            {language === 'ko' ? '이전 버전' : 'Earlier versions'}
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
      ) : showArchiveList ? (
        <section className="mx-auto max-w-3xl px-5 py-7 sm:px-8">
          <h1 className="text-xl font-bold">{language === 'ko' ? '이전 버전' : 'Earlier versions'}</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {language === 'ko'
              ? `현재 버전은 ${LEGAL_DOCUMENT_VERSION}입니다. 이전에 게시된 이용약관, 개인정보 처리방침, 커뮤니티 가이드라인을 볼 수 있습니다.`
              : `The current version is ${LEGAL_DOCUMENT_VERSION}. You can read the Terms, Privacy Policy and Community Guidelines as published earlier.`}
          </p>
          <ul className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-[#2c2c2e] dark:border-[#2c2c2e]">
            {LEGAL_ARCHIVE.map((entry) => (
              <li key={entry.version} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium">{entry.version}</span>
                {entry.available ? (
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveError(false)
                      setArchive(null)
                      setArchiveVersion(entry.version)
                      setShowArchiveList(false)
                    }}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  >
                    {language === 'ko' ? '원문 보기' : 'View'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {language === 'ko' ? '원문 보관 없음' : 'Text not archived'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : archiveVersion && !viewingArchive ? (
        <section className="mx-auto max-w-3xl px-5 py-7 text-sm text-gray-500 sm:px-8 dark:text-gray-400">
          {archiveError
            ? (language === 'ko' ? '이전 버전을 불러오지 못했습니다.' : 'Could not load this version.')
            : (language === 'ko' ? '불러오는 중…' : 'Loading…')}
          <button type="button" onClick={backToCurrent} className="ml-3 font-semibold text-orange-600 underline">
            {language === 'ko' ? '현재 버전 보기' : 'Show current version'}
          </button>
        </section>
      ) : (
        <article id="legal-document-content" className="legal-document-content mx-auto max-w-3xl px-5 py-7 sm:px-8">
          {viewingArchive && (
            <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {language === 'ko'
                ? `이전 버전(${archiveVersion})입니다. 현재 적용되는 문서가 아닙니다.`
                : `This is an earlier version (${archiveVersion}). It is not the version currently in force.`}
              {koreanMissing && <span className="mt-1 block">이 버전은 영어로만 게시되었습니다.</span>}
              <button type="button" onClick={backToCurrent} className="mt-2 block font-semibold underline">
                {language === 'ko' ? '현재 버전 보기' : 'Show current version'}
              </button>
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {language === 'ko' ? '문서 버전' : 'Document version'}: {viewingArchive ? archiveVersion : LEGAL_DOCUMENT_VERSION}
          </p>
          <h1 className="mt-2 text-2xl font-bold">{content.title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {language === 'ko' ? '시행일' : 'Effective Date'}: {content.effectiveDate}
          </p>
          <div className="mt-6 space-y-3 text-sm leading-7 text-gray-700 dark:text-gray-200">
            {content.body.split('\n').map((line, index) => (
              <p key={`${archiveVersion || 'current'}-${activeKey}-${language}-${index}`} className={line.trim() ? '' : 'h-1'}>
                {line}
              </p>
            ))}
          </div>
        </article>
      )}
    </main>
  )
}
