export function getProfileImagePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const rawValue = value.trim()
  const markers = [
    '/object/public/profile-images/',
    '/object/sign/profile-images/',
    '/profile-images/',
  ]

  for (const marker of markers) {
    const markerIndex = rawValue.indexOf(marker)
    if (markerIndex === -1) continue
    const encodedPath = rawValue.slice(markerIndex + marker.length).split('?')[0]
    return normalizePath(encodedPath)
  }

  return normalizePath(rawValue)
}

function normalizePath(value) {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(value)
  } catch {
    return null
  }
  const path = decodedPath.replace(/^\/+/, '')
  return /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i.test(path)
    ? path
    : null
}
