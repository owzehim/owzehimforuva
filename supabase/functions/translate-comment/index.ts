import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

// Retired: the current app does not call this endpoint. Keep future deploys
// from restoring the old service-role comment read and translation path.
Deno.serve((req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(JSON.stringify({ message: 'This translation endpoint is no longer available.' }), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
})
