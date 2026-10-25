import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CaretLeft } from '@phosphor-icons/react'

export default function ThirdPartyLicensesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const language = searchParams.get('lang') === 'en' ? 'en' : 'ko'
  const copy = language === 'ko'
    ? {
        back: '뒤로',
        title: '오픈소스 라이선스',
        loading: '라이선스 목록을 불러오는 중',
        error: '라이선스 목록을 불러오지 못했습니다. 앱을 빌드한 뒤 다시 확인해 주세요.',
      }
    : {
        back: 'Back',
        title: 'Open-source licenses',
        loading: 'Loading licenses',
        error: 'The license list is unavailable. Check again after the app has been built.',
      }
  const [licenseText, setLicenseText] = useState('')
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/third-party-licenses.md')
      .then((response) => {
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
          throw new Error('License file is unavailable')
        }
        return response.text()
      })
      .then((text) => {
        if (!cancelled) setLicenseText(text)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="legal-page min-h-dvh bg-white text-gray-900 dark:bg-[#121212] dark:text-white">
      <header className="legal-page-controls sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-[#2c2c2e] dark:bg-[#121212]/95">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 items-center gap-1 rounded-full px-2 text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            <CaretLeft size={18} /> {copy.back}
          </button>
          <h1 className="text-lg font-bold">{copy.title}</h1>
        </div>
      </header>
      <article className="legal-document-content mx-auto max-w-3xl px-5 py-7 sm:px-8">
        {loadError ? (
          <p className="text-sm text-gray-500">{copy.error}</p>
        ) : licenseText ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
            {licenseText}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">{copy.loading}</p>
        )}
      </article>
    </main>
  )
}
