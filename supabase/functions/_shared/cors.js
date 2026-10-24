const DEV_SUPABASE_PROJECT_REF = 'smesebnighdcwqcgokhg'
const PRODUCTION_SUPABASE_PROJECT_REF = 'npvcghdzrtqrlliprtnw'
const DEV_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://uvain-app-git-dev-woojaylim-4666s-projects.vercel.app',
]
const PRODUCTION_ALLOWED_ORIGINS = [
  'https://app.uva-in.nl',
  'https://uvain-app.vercel.app',
  'http://localhost:5173',
]

function currentProjectRef() {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    return new URL(supabaseUrl).hostname.split('.')[0]
  } catch {
    return ''
  }
}

function defaultAllowedOrigins(projectRef) {
  if (projectRef === DEV_SUPABASE_PROJECT_REF) return DEV_ALLOWED_ORIGINS
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) return PRODUCTION_ALLOWED_ORIGINS

  return ['http://localhost:5173']
}

function allowedOrigins(configuredOrigins) {
  const projectRef = currentProjectRef()
  const configured = configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const devDisallowedOrigins = projectRef === DEV_SUPABASE_PROJECT_REF
    ? new Set(PRODUCTION_ALLOWED_ORIGINS.filter((origin) => origin !== 'http://localhost:5173'))
    : new Set()
  const allowed = [...defaultAllowedOrigins(projectRef), ...configured]
    .filter((origin) => !devDisallowedOrigins.has(origin))
  return new Set(allowed)
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
