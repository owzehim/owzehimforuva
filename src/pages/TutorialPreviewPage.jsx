import { useState } from 'react'
import { WelcomeSlides } from './MemberPage'

export default function TutorialPreviewPage() {
  const [open, setOpen] = useState(true)

  if (open) {
    return <WelcomeSlides member={null} onFinish={() => setOpen(false)} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 dark:bg-[#121212]">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-white active:bg-orange-600"
      >
        미리보기 다시 시작
      </button>
    </div>
  )
}
