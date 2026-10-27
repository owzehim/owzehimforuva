export default function DevelopmentCaptchaPreview({ language = 'ko' }) {
  return (
    <div
      role="note"
      aria-label={language === 'ko' ? '캡챠 개발 미리보기' : 'Captcha development preview'}
      className="mx-auto flex min-h-[73px] w-full max-w-[300px] items-center justify-between border border-[#d3d3d3] bg-[#fafafa] px-3 text-[#222] shadow-sm"
    >
      <div className="flex items-center gap-3 text-sm">
        <span aria-hidden="true" className="h-6 w-6 border-2 border-[#888] bg-white" />
        <span>{language === 'ko' ? '자동 확인 미리보기' : 'Human verification preview'}</span>
      </div>
      <span className="text-center text-[9px] leading-tight text-[#666]">
        <strong className="block text-[11px]">CAPTCHA</strong>
        DEV PREVIEW
      </span>
    </div>
  );
}
