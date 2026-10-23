export function shouldAutoDetectSessionInUrl(pathname) {
  const normalizedPath = String(pathname || '/').replace(/\/+$/, '') || '/'
  return normalizedPath !== '/reset-password'
}
