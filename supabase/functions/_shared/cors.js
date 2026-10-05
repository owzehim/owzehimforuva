const DEFAULT_ALLOWED_ORIGINS = [
  'https://app.uva-in.nl',
  'https://uvain-app.vercel.app',
  'http://localhost:5173',
]

function allowedOrigins(configuredOrigins) {
  const configured = configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])
}

export function isAllowedCorsOrigin(origin, configuredOrigins = '') {
  return !origin || allowedOrigins(configuredOrigins).has(origin)
}

export function getCorsHeaders(origin, configuredOrigins = '') {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retention-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }

  if (origin && allowedOrigins(configuredOrigins).has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}
