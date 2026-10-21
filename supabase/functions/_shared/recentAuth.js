export function hasRecentAuthTime(claims, nowMs = Date.now(), maxAgeSeconds = 600) {
  const authTime = claims?.auth_time
  if (!Number.isInteger(authTime)) return false

  const nowSeconds = Math.floor(nowMs / 1000)
  return authTime <= nowSeconds + 60 && nowSeconds - authTime <= maxAgeSeconds
}
