// GDPR-04: a member downloads a copy of their own data (JSON).
// Same login checks as account deletion: verified email login and the active
// device session. Only the caller's own rows are read; 5 exports per hour.
import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { collectMemberData, referencedPlaceIds, referencedStoreIds } from '../_shared/memberDataExport.js'

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ success: false, message: '로그인이 필요합니다.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Data export service configuration is missing')
      return json({ success: false, message: '내 정보 다운로드를 지금 사용할 수 없습니다.' }, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userError || !user) return json({ success: false, message: '다시 로그인해 주세요.' }, 401)
    if (!hasVerifiedAppLogin(token, user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, user.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    const { data: allowed, error: limitError } = await admin.rpc('consume_edge_rate_limit', {
      p_key_hash: await sha256Hex(`export-my-data:${user.id}`),
      p_limit: 5,
      p_window_seconds: 3600,
    })
    if (limitError) {
      console.error('Data export rate limit check failed')
      return json({ success: false, message: '잠시 후 다시 시도해 주세요.' }, 503)
    }
    if (allowed !== true) {
      return json({ success: false, message: '다운로드 요청이 많습니다. 1시간 후 다시 시도해 주세요.' }, 429)
    }

    const data = await collectMemberData(admin, user.id)

    const placeIds = referencedPlaceIds(data)
    const storeIds = referencedStoreIds(data)
    const [placesResult, storesResult] = await Promise.all([
      placeIds.length
        ? admin.from('restaurants').select('id, name').in('id', placeIds)
        : Promise.resolve({ data: [], error: null }),
      storeIds.length
        ? admin.from('partnerships').select('id, name').in('id', storeIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (placesResult.error || storesResult.error) throw new Error('Export place names failed')

    return json({
      success: true,
      export: {
        format: 'uvain-member-data-export',
        format_version: 1,
        generated_at: new Date().toISOString(),
        account: {
          email: user.email ?? null,
          account_created_at: user.created_at ?? null,
          email_confirmed_at: user.email_confirmed_at ?? null,
          last_sign_in_at: user.last_sign_in_at ?? null,
        },
        ...data,
        place_names: Object.fromEntries((placesResult.data || []).map((row: { id: string; name: string }) => [row.id, row.name])),
        store_names: Object.fromEntries((storesResult.data || []).map((row: { id: string; name: string }) => [row.id, row.name])),
        note: 'This file contains the personal data UvA-IN holds about you in the app database. Internal Google Sheets records are copies of the same data. Questions: uvaksa16@gmail.com',
      },
    })
  } catch (error) {
    console.error('Data export failed', { error: error instanceof Error ? error.message : 'unknown' })
    return json({ success: false, message: '내 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
})
