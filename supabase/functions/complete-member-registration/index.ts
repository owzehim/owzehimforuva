import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getConsentAcceptedAt, getConsentReceiptRows } from '../_shared/legalConsent.js'
import { getStudentNumberRegistrationFields } from '../_shared/memberStudentNumber.js'

function text(value: unknown, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null
}

function optionalText(value: unknown, maxLength = 200) {
  if (value === null || value === undefined || value === '') return null
  return text(value, maxLength)
}

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

const ALLOWED_EDUCATION_LEVELS = new Set(['foundation', 'bachelor', 'master', 'alumni'])
const REGISTRATION_METADATA_KEYS = [
  'registration',
  'registration_accepted_at',
  'first_name',
  'last_name',
  'first_name_korean',
  'last_name_korean',
  'name',
]

function clearRegistrationMetadata(metadata: Record<string, unknown> | null | undefined) {
  const nextMetadata = { ...(metadata || {}) }
  for (const key of REGISTRATION_METADATA_KEYS) nextMetadata[key] = null
  return nextMetadata
}

function isValidRegistration(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  const yearOfBirth = integerOrNull(profile.year_of_birth)
  const yearNumber = integerOrNull(profile.year_number)

  return Boolean(
    profile.age_16_plus_confirmed === true &&
    text(profile.first_name, 100) &&
    text(profile.last_name, 100) &&
    getStudentNumberRegistrationFields(profile.student_number) !== null &&
    text(profile.major, 160) &&
    (profile.gender === null || profile.gender === undefined || profile.gender === '' ||
      ['male', 'female', 'non_binary', 'prefer_not_to_say'].includes(String(profile.gender))) &&
    (profile.country_of_origin === null || profile.country_of_origin === undefined ||
      profile.country_of_origin === '' || text(profile.country_of_origin, 100) !== null) &&
    text(profile.university, 160) &&
    typeof profile.education_level === 'string' &&
    ALLOWED_EDUCATION_LEVELS.has(profile.education_level) &&
    (yearOfBirth === null || (yearOfBirth !== undefined && yearOfBirth >= 1900 && yearOfBirth <= new Date().getFullYear())) &&
    (yearNumber === null || (yearNumber !== undefined && yearNumber >= 1 && yearNumber <= 20)) &&
    typeof profile.privacy_policy_version === 'string' &&
    profile.privacy_policy_version.length <= 80 &&
    getConsentReceiptRows('pending-user', profile, 'pending-time') !== null
  )
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return json({ success: false, message: '로그인이 필요합니다.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Supabase service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user) return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    if (!user.email_confirmed_at) {
      return json({ success: false, message: '이메일 인증을 완료한 뒤 다시 시도해주세요.' }, 403)
    }
    const { data: pendingEmailChange, error: pendingEmailLookupError } = await admin
      .from('pending_email_changes')
      .select('original_created_at')
      .eq('new_user_id', user.id)
      .maybeSingle()
    if (pendingEmailLookupError) {
      console.error('Pending email timestamp lookup failed')
      return json({ success: false, message: '회원가입 상태를 확인하지 못했습니다.' }, 503)
    }
    // The pending-email mapping is service-only; never trust client metadata
    // when preserving the original Auth-generated signup time.
    const consentAcceptedAt = getConsentAcceptedAt(user, pendingEmailChange?.original_created_at)

    const body = await req.json().catch(() => ({}))
    if (Object.keys(body || {}).length > 0) {
      return json({ success: false, message: '요청에 허용되지 않은 프로필 데이터가 포함되어 있습니다.' }, 400)
    }

    const registration = user.user_metadata?.registration
    const { data: existingMember, error: existingError } = await admin
      .from('members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingError) {
      console.error('Member registration lookup failed')
      return json({ success: false, message: '회원가입 상태를 확인하지 못했습니다.' }, 500)
    }
    if (existingMember) {
      if (isValidRegistration(registration)) {
        const receipts = getConsentReceiptRows(user.id, registration, consentAcceptedAt)
        const { error: receiptError } = await admin
          .from('legal_consent_receipts')
          .upsert(receipts, {
            onConflict: 'user_id,document_key,document_version',
            ignoreDuplicates: true,
          })
        if (receiptError) {
          console.error('Existing member consent receipt recovery failed')
          return json({ success: false, message: '동의 기록을 저장하지 못했습니다.' }, 500)
        }
      }
      const { error: cleanupError } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: clearRegistrationMetadata(user.user_metadata),
      })
      if (cleanupError) console.error('Completed registration metadata cleanup failed')
      const { error: pendingCleanupError } = await admin
        .from('pending_email_changes')
        .delete()
        .eq('new_user_id', user.id)
      if (pendingCleanupError) console.error('Completed pending email mapping cleanup failed')
      return json({ success: true, alreadyCompleted: true })
    }

    if (!isValidRegistration(registration)) {
      return json({ success: false, message: '회원가입 정보를 찾을 수 없습니다. 가입을 시작한 기기에서 다시 시도하거나 지원팀에 문의해주세요.' }, 400)
    }

    const yearOfBirth = integerOrNull(registration.year_of_birth)
    const yearNumber = integerOrNull(registration.year_number)
    const row = {
      user_id: user.id,
      first_name: text(registration.first_name, 100),
      last_name: text(registration.last_name, 100),
      first_name_korean: optionalText(registration.first_name_korean, 100),
      last_name_korean: optionalText(registration.last_name_korean, 100),
      ...getStudentNumberRegistrationFields(registration.student_number),
      year_of_birth: yearOfBirth,
      gender: optionalText(registration.gender, 40),
      country_of_origin: optionalText(registration.country_of_origin, 100),
      University: text(registration.university, 160),
      major: text(registration.major, 160),
      education_level: text(registration.education_level, 40),
      year_number: registration.education_level === 'alumni' ? null : yearNumber,
      // Profile photos are uploaded later through the private owner-scoped
      // Storage flow. Never persist a client-supplied external image URL.
      profile_image_url: null,
      privacy_policy_version: text(registration.privacy_policy_version, 80),
      privacy_accepted_at: consentAcceptedAt,
      is_member: false,
      membership_valid_until: null,
      account_status: 'active',
      is_test_account: false,
      identity_anonymized_at: null,
      membership_ended_at: null,
      session_token: null,
    }

    const { error: insertError } = await admin.from('members').insert(row)
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: racedMember, error: raceLookupError } = await admin
          .from('members')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!raceLookupError && racedMember) {
          const receipts = getConsentReceiptRows(user.id, registration, consentAcceptedAt)
          const { error: receiptError } = await admin
            .from('legal_consent_receipts')
            .upsert(receipts, {
              onConflict: 'user_id,document_key,document_version',
              ignoreDuplicates: true,
            })
          if (receiptError) {
            console.error('Raced member consent receipt recovery failed')
            return json({ success: false, message: '동의 기록을 저장하지 못했습니다.' }, 500)
          }
          const { error: cleanupError } = await admin.auth.admin.updateUserById(user.id, {
            user_metadata: clearRegistrationMetadata(user.user_metadata),
          })
          if (cleanupError) console.error('Raced registration metadata cleanup failed')
          const { error: pendingCleanupError } = await admin
            .from('pending_email_changes')
            .delete()
            .eq('new_user_id', user.id)
          if (pendingCleanupError) console.error('Raced pending email mapping cleanup failed')
          return json({ success: true, alreadyCompleted: true })
        }
        return json({ success: false, message: '이미 사용 중인 학번 또는 회원 계정입니다. 정보를 확인하거나 지원팀에 문의해주세요.' }, 409)
      }
      console.error('Member registration insert failed:', { code: insertError.code })
      return json({ success: false, message: '회원 정보를 저장하지 못했습니다.' }, 500)
    }

    const receipts = getConsentReceiptRows(user.id, registration, consentAcceptedAt)
    const { error: receiptError } = await admin
      .from('legal_consent_receipts')
      .upsert(receipts, {
        onConflict: 'user_id,document_key,document_version',
        ignoreDuplicates: true,
      })
    if (receiptError) {
      console.error('Member consent receipt insert failed')
      return json({ success: false, message: '동의 기록을 저장하지 못했습니다.' }, 500)
    }

    const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: clearRegistrationMetadata(user.user_metadata),
    })
    if (metadataError) console.error('Completed registration metadata cleanup failed')

    const { error: pendingCleanupError } = await admin
      .from('pending_email_changes')
      .delete()
      .eq('new_user_id', user.id)
    if (pendingCleanupError) console.error('Completed pending email mapping cleanup failed')

    return json({ success: true })
  } catch (error) {
    console.error('Unexpected member registration error', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return json({ success: false, message: '회원가입을 완료하지 못했습니다.' }, 500)
  }
})
