import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession } from '../_shared/requireVerifiedLogin.ts'
import { recordAdminAction } from '../_shared/adminAudit.ts'

function isValidDate(value: unknown) {
  if (value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

Deno.serve(async (req) => {
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

  let createdUserId: string | null = null
  let admin: any = null

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return json({ success: false, message: '로그인이 필요합니다.' }, 401)

    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const firstName = typeof body?.first_name === 'string' ? body.first_name.trim() : ''
    const lastName = typeof body?.last_name === 'string' ? body.last_name.trim() : ''
    const studentNumber = typeof body?.student_number === 'string' ? body.student_number.trim() : ''
    const major = typeof body?.major === 'string' ? body.major.trim() : ''
    const skipEmailConfirmation = email === 'test@uvain.nl'
    const isTestAccount = email === 'test@uvain.nl'
    const isMember = body?.is_member === true
    const membershipValidUntil = body?.membership_valid_until ?? null

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 12 ||
      password.length > 128 ||
      !firstName || firstName.length > 100 ||
      !lastName || lastName.length > 100 ||
      !studentNumber || studentNumber.length > 80 ||
      !major || major.length > 160 ||
      typeof body?.is_member !== 'boolean' ||
      !isValidDate(membershipValidUntil)
    ) {
      return json({ success: false, message: '회원 정보가 올바르지 않습니다.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Supabase service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const caller = authData?.user
    if (authError || !caller) return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    if (!hasVerifiedAppLogin(token, caller.id)) {
      return json({ success: false, message: '이메일 인증을 포함해 다시 로그인해 주세요.' }, 403)
    }
    if (!(await hasActiveDeviceSession(admin, caller.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    const { data: adminRole, error: roleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()
    if (roleError) {
      console.error('Admin role lookup failed:', roleError)
      return json({ success: false, message: '관리자 권한을 확인할 수 없습니다.' }, 500)
    }
    if (!adminRole) return json({ success: false, message: '관리자 권한이 필요합니다.' }, 403)

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: skipEmailConfirmation,
      user_metadata: { first_name: firstName, last_name: lastName },
    })
    if (createUserError || !createdUser.user) {
      if (createUserError?.status === 422) {
        return json({ success: false, message: '이미 사용 중인 이메일일 수 있습니다.' }, 409)
      }
      console.error('Admin auth user creation failed:', createUserError)
      return json({ success: false, message: '계정을 생성하지 못했습니다.' }, 500)
    }
    createdUserId = createdUser.user.id

    const { data: createdMember, error: insertError } = await admin.from('members').insert({
      user_id: createdUserId,
      first_name: firstName,
      last_name: lastName,
      student_number: studentNumber,
      major,
      is_member: isMember,
      membership_valid_until: membershipValidUntil,
      account_status: 'active',
      is_test_account: isTestAccount,
      identity_anonymized_at: null,
      membership_ended_at: null,
      session_token: null,
    }).select('id').single()

    if (insertError) {
      await admin.auth.admin.deleteUser(createdUserId)
      createdUserId = null
      if (insertError.code === '23505') {
        return json({ success: false, message: '이미 사용 중인 이메일 또는 학번입니다.' }, 409)
      }
      console.error('Admin member row creation failed:', insertError)
      return json({ success: false, message: '회원 정보를 저장하지 못했습니다.' }, 500)
    }

    if (!skipEmailConfirmation) {
      const { error: emailError } = await admin.auth.resend({ type: 'signup', email })
      if (emailError) {
        await admin.from('members').delete().eq('user_id', createdUserId)
        await admin.auth.admin.deleteUser(createdUserId)
        createdUserId = null
        console.error('Admin-created member confirmation email failed:', emailError)
        return json({ success: false, message: '인증 이메일을 보내지 못해 회원 생성을 취소했습니다.' }, 502)
      }
    }

    const auditLogged = await recordAdminAction(admin, {
      actorId: caller.id,
      action: 'member.create',
      resourceType: 'members',
      resourceId: createdMember.id,
      changedFields: ['account_status', 'is_member', 'membership_valid_until'],
    })

    return json({ success: true, auditLogged })
  } catch (error) {
    if (createdUserId && admin) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId)
      if (cleanupError) console.error('Failed to roll back created auth user:', cleanupError)
    }
    console.error('Unexpected admin member creation error:', error)
    return json({ success: false, message: '회원을 추가하지 못했습니다.' }, 500)
  }
})
