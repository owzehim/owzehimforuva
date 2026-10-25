export function shouldLockDevInteractions({ isViteDev, hostname }) {
  const isDevBranchPreview =
    typeof hostname === 'string' &&
    hostname.endsWith('.vercel.app') &&
    hostname.includes('-git-dev-')

  return Boolean(isViteDev || isDevBranchPreview)
}
