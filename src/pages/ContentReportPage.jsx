import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const REPORT_EMAIL = 'uvaksa16@gmail.com'
const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase()
const language = browserLanguage.startsWith('nl') ? 'nl' : browserLanguage.startsWith('en') ? 'en' : 'ko'

const copy = {
  ko: {
    title: '콘텐츠 신고', close: '닫기', intro: '한국어, 영어, 네덜란드어로 신고할 수 있습니다. 신고 내용을 확인하고 이메일 앱에서 보내기를 눌러 접수해 주세요.',
    name: '이름', email: '이메일', location: '콘텐츠 위치 또는 매장', locationPlaceholder: '매장 이름, 작성자, 날짜 등', reason: '신고 사유',
    reasons: ['위협 또는 괴롭힘', '개인정보 또는 사생활 침해', '저작권 또는 지식재산권 침해', '그 밖의 불법 콘텐츠', '커뮤니티 가이드라인 위반'],
    explanation: '설명', goodFaith: '선의로 신고하며, 입력한 내용이 정확하고 완전하다고 확인합니다.', submit: '이메일 앱에서 신고 작성',
  },
  en: {
    title: 'Report content', close: 'Close', intro: 'You can report in Korean, English, or Dutch. Review the report and press Send in your email app to submit it.',
    name: 'Name', email: 'Email', location: 'Content location or venue', locationPlaceholder: 'Venue, author, date, or other identifying details', reason: 'Reason for report',
    reasons: ['Threats or harassment', 'Privacy or personal data', 'Copyright or intellectual property', 'Other illegal content', 'Community Guidelines violation'],
    explanation: 'Explanation', goodFaith: 'I am making this report in good faith and confirm the information is accurate and complete.', submit: 'Continue in email app',
  },
  nl: {
    title: 'Inhoud melden', close: 'Sluiten', intro: 'Je kunt melden in het Koreaans, Engels of Nederlands. Controleer de melding en druk op Verzenden in je e-mailapp.',
    name: 'Naam', email: 'E-mail', location: 'Locatie van de inhoud of zaak', locationPlaceholder: 'Zaak, auteur, datum of andere herkenningspunten', reason: 'Reden van melding',
    reasons: ['Bedreiging of intimidatie', 'Privacy of persoonsgegevens', 'Auteursrecht of intellectueel eigendom', 'Andere illegale inhoud', 'Schending van de communityrichtlijnen'],
    explanation: 'Toelichting', goodFaith: 'Ik meld dit te goeder trouw en bevestig dat de informatie juist en volledig is.', submit: 'Verder in e-mailapp',
  },
}[language]

const reasonCodes = ['illegal_threat', 'privacy', 'intellectual_property', 'other_illegal', 'community_guidelines']

export default function ContentReportPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [location, setLocation] = useState('')
  const [reason, setReason] = useState('illegal_threat')
  const [explanation, setExplanation] = useState('')
  const [goodFaith, setGoodFaith] = useState(false)

  const submit = (event) => {
    event.preventDefault()
    const reasonLabel = copy.reasons[reasonCodes.indexOf(reason)]
    const subject = '[UvA-IN] 콘텐츠 신고'
    const body = [
      `신고자 이름: ${name.trim()}`,
      `이메일: ${email.trim()}`,
      `콘텐츠 위치 또는 매장: ${location.trim()}`,
      `신고 사유: ${reasonLabel}`,
      `설명: ${explanation.trim()}`,
      '선의로 신고하며, 입력한 내용이 정확하고 완전함을 확인합니다.',
    ].join('\n\n')
    window.location.href = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8 dark:bg-[#121212]">
      <form onSubmit={submit} className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-sm dark:bg-[#1e1e1e]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{copy.title}</h1>
          <button type="button" onClick={() => navigate('/public')} className="text-sm text-gray-500">{copy.close}</button>
        </div>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {copy.intro}
        </p>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {copy.name}
          <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-transparent p-2.5" />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {copy.email}
          <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-transparent p-2.5" />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {copy.location}
          <input required maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder={copy.locationPlaceholder} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-transparent p-2.5" />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {copy.reason}
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-gray-900 dark:bg-[#1e1e1e] dark:text-white">
            {reasonCodes.map((code, index) => <option key={code} value={code}>{copy.reasons[index]}</option>)}
          </select>
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {copy.explanation}
          <textarea required minLength={10} maxLength={2000} rows={4} value={explanation} onChange={(event) => setExplanation(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-transparent p-2.5" />
        </label>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          <input required type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} className="mt-0.5" />
          {copy.goodFaith}
        </label>
        <button type="submit" disabled={!goodFaith} className="w-full rounded-full bg-orange-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {copy.submit}
        </button>
      </form>
    </main>
  )
}
