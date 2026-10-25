export default function LoadingIndicator({ label = '로딩 중...', fullScreen = false }) {
  return (
    <div
      className={fullScreen
        ? 'fixed inset-0 z-[5000] flex items-center justify-center bg-white dark:bg-[#121212]'
        : 'flex w-full items-center justify-center gap-2.5'}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="app-loading-spinner h-5 w-5 animate-spin rounded-full border-2"
      />
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  )
}
