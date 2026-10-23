import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession } from '../_shared/requireVerifiedLogin.ts'
import { recordAdminAction } from '../_shared/adminAudit.ts'

const allowedFields = new Set([
  'first_name',
  'last_name',
  'student_number',
  'major',
  'year_of_birth',
  'gender',
  'country_of_origin',
  'University',
  'education_level',
  'year_number',
  'is_member',
  'membership_valid_until',
])

function isValidDate(value: unknown) {
  if (value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function amsterdamToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function validateUpdates(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const updates = value as Record<string, unknown>
  const keys = Object.keys(updates)
  if (keys.length === 0 || keys.some((key) => !allowedFields.has(key))) return false

  if ('is_member' in updates && typeof updates.is_member !== 'boolean') return false
  if ('membership_valid_until' in updates && !isValidDate(updates.membership_valid_until)) return false
  if (
    'gender' in updates &&
    updates.gender !== null &&
    !['male', 'female', 'non_binary', 'prefer_not_to_say'].includes(String(updates.gender))
  ) return false

  for (const field of ['year_of_birth', 'year_number']) {
    if (!(field in updates)) continue
    const fieldValue = updates[field]
    if (
      fieldValue !== null &&
      !(typeof fieldValue === 'number' && Number.isInteger(fieldValue)) &&
      !(typeof fieldValue === 'string' && /^\d+$/.test(fieldValue))
    ) return false
  }

  for (const field of [
    'first_name',
    'last_name',
    'student_number',
    'major',
    'gender',
    'country_of_origin',
    'University',
    'education_level',
  ]) {
    if (field in updates && updates[field] !== null && typeof updates[field] !== 'string') {
      return false
    }
  }

  return true
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }

    const body = await req.json().catch(() => null)
    const memberId = body?.memberId
    const updates = body?.updates
    if (
      typeof memberId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId) ||
      !validateUpdates(updates)
    ) {
      return json({ success: false, message: '잘못된 회원 수정 요청입니다.' }, 400)
    }

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

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const caller = userData?.user
    if (userError || !caller) {
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }
    if (!hasVerifiedAppLogin(token, caller.id)) {
      return json({ success: false, message: '이메일 인증을 포함해 다시 로그인해 주세요.' }, 403)
    }
    if (!(await hasActiveDeviceSession(admin, caller.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    const { data: adminRole, error: adminRoleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (adminRoleError) {
      console.error('Admin role lookup failed:', adminRoleError)
      return json({ success: false, message: '관리자 권한을 확인할 수 없습니다.' }, 500)
    }
    if (!adminRole) {
      return json({ success: false, message: '관리자 권한이 필요합니다.' }, 403)
    }

    const safeUpdates = { ...updates }
    if ('student_number' in safeUpdates) {
      const claimedValue = safeUpdates.student_number
      safeUpdates.student_number = typeof claimedValue === 'string' && claimedValue.trim()
        ? claimedValue.trim()
        : null
      // Only this admin-authorized path can promote the claim to the unique,
      // verified field, and promotion consumes the pending value.
      safeUpdates.pending_student_number = null
    }

    if (safeUpdates.is_member === true) {
      const { data: currentMember, error: memberLookupError } = await admin
        .from('members')
        .select('membership_valid_until')
        .eq('id', memberId)
        .maybeSingle()
      if (memberLookupError) {
        console.error('Membership activation lookup failed:', memberLookupError)
        return json({ success: false, message: '회원 상태를 확인할 수 없습니다.' }, 500)
      }

      const membershipValidUntil = 'membership_valid_until' in safeUpdates
        ? safeUpdates.membership_valid_until
        : currentMember?.membership_valid_until
      if (typeof membershipValidUntil !== 'string' || membershipValidUntil < amsterdamToday()) {
        return json({ success: false, message: '멤버십을 활성화하려면 오늘 이후의 유효기간을 먼저 설정해 주세요.' }, 400)
      }
    }

    const { data: updatedMember, error: updateError } = await admin
      .from('members')
      .update(safeUpdates)
      .eq('id', memberId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Admin member update failed:', updateError)
      if (updateError.code === '23505' && 'student_number' in safeUpdates) {
        return json({ success: false, message: '이 학번은 이미 다른 계정에 확정되어 있습니다.' }, 409)
      }
      return json({ success: false, message: '회원 정보를 수정하지 못했습니다.' }, 500)
    }
    if (!updatedMember) {
      return json({ success: false, message: '회원을 찾을 수 없습니다.' }, 404)
    }

    const auditLogged = await recordAdminAction(admin, {
      actorId: caller.id,
      action: 'member.update',
      resourceType: 'members',
      resourceId: memberId,
      changedFields: Object.keys(safeUpdates),
    })

    return json({ success: true, auditLogged })
  } catch (error) {
    console.error('Unexpected admin member update error:', error)
    return json({ success: false, message: '회원 정보를 수정하지 못했습니다.' }, 500)
  }
})
