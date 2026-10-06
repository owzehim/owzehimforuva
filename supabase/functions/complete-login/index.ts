import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PASSWORD_PROOF_MAX_AGE_SECONDS = 10 * 60

function decodeClaims(accessToken: string): Record<string, unknown> | null {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function hasAuthMethod(claims: Record<string, unknown>, method: string) {
  return Array.isArray(claims.amr) && claims.amr.some(
    (entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).method === method,
  )
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  try {
    const otpToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!otpToken || otpToken.length > 8192) {
      return json({ success: false, message: '이메일 인증이 필요합니다.' }, 401)
    }

    const body = await req.json().catch(() => null)
    const passwordToken = body?.passwordAccessToken
    if (typeof passwordToken !== 'string' || passwordToken.length > 8192) {
      return json({ success: false, message: '비밀번호 인증 정보가 없습니다.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Login completion service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    // Each token is independently validated by Supabase Auth. The password
    // token is a short-lived proof kept only in the browser's memory.
    const [otpUserResult, passwordUserResult] = await Promise.all([
      admin.auth.getUser(otpToken),
      admin.auth.getUser(passwordToken),
    ])
    const otpUser = otpUserResult.data?.user
    const passwordUser = passwordUserResult.data?.user
    const otpClaims = decodeClaims(otpToken)
    const passwordClaims = decodeClaims(passwordToken)

    if (
      otpUserResult.error || passwordUserResult.error || !otpUser || !passwordUser ||
      !otpClaims || !passwordClaims || otpUser.id !== passwordUser.id ||
      !otpUser.email_confirmed_at || !passwordUser.email_confirmed_at ||
      String(otpUser.email || '').trim().toLowerCase() !== String(passwordUser.email || '').trim().toLowerCase()
    ) {
      return json({ success: false, message: '로그인 인증을 다시 시작해주세요.' }, 401)
    }

    const now = Math.floor(Date.now() / 1000)
    const passwordIssuedAt = Number(passwordClaims.iat)
    const passwordExpiresAt = Number(passwordClaims.exp)
    const otpIssuedAt = Number(otpClaims.iat)
    const passwordSessionId = passwordClaims.session_id
    const otpSessionId = otpClaims.session_id
    if (
      !hasAuthMethod(passwordClaims, 'password') ||
      !hasAuthMethod(otpClaims, 'otp') ||
      !Number.isFinite(passwordIssuedAt) ||
      now - passwordIssuedAt > PASSWORD_PROOF_MAX_AGE_SECONDS ||
      passwordIssuedAt > now + 30 ||
      !Number.isFinite(otpIssuedAt) ||
      now - otpIssuedAt > PASSWORD_PROOF_MAX_AGE_SECONDS ||
      otpIssuedAt < passwordIssuedAt ||
      otpIssuedAt > now + 30 ||
      !Number.isFinite(passwordExpiresAt) || passwordExpiresAt <= now ||
      typeof passwordSessionId !== 'string' || !UUID_PATTERN.test(passwordSessionId) ||
      typeof otpSessionId !== 'string' || !UUID_PATTERN.test(otpSessionId) ||
      passwordSessionId === otpSessionId
    ) {
      return json({ success: false, message: '비밀번호 확인이 만료되었습니다. 다시 로그인해주세요.' }, 401)
    }

    const { error: grantError } = await admin
      .from('login_otp_verified_sessions')
      .upsert({ session_id: otpSessionId, user_id: otpUser.id, verified_at: new Date().toISOString() }, {
        onConflict: 'session_id',
      })

    if (grantError) {
      console.error('Unable to record a verified login session:', grantError.code)
      return json({ success: false, message: '로그인 인증을 완료하지 못했습니다.' }, 500)
    }

    return json({ success: true })
  } catch (error) {
    console.error('Unexpected login completion error:', error instanceof Error ? error.name : 'unknown')
    return json({ success: false, message: '로그인 인증을 완료하지 못했습니다.' }, 500)
  }
})
