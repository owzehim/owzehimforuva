// src/domain/auth/authRules.js
//
// Pure business rules for authentication.
// ✅ Copy as-is to React Native — zero React/web dependencies.

/**
 * Accounts that skip the OTP step entirely.
 * Add any test or admin emails here.
 */
const OTP_EXEMPT_EMAILS = [
  'test@uvain.nl',
  'admin@uvain.nl',
  'northeastkitchen@uvain.nl',
]

/**
 * Returns true if this email should skip the OTP verification step.
 * Case-insensitive.
 *
 * @param {string} email
 * @returns {boolean}
 */
export function isOtpExempt(email) {
  return OTP_EXEMPT_EMAILS.includes(email.trim().toLowerCase())
}

/**
 * Validates a 6-digit OTP string entered by the user.
 * Returns an error string, or '' if valid.
 *
 * @param {string} otp
 * @returns {string}
 */
export function validateOtpInput(otp) {
  if (!otp || otp.trim().length === 0) return 'Please enter the verification code'
  if (!/^\d{6}$/.test(otp.trim())) return 'The code must be exactly 6 digits'
  return ''
}

/**
 * Maps Supabase auth error messages to user-friendly strings.
 *
 * @param {string} supabaseMessage
 * @returns {string}
 */
export function mapAuthError(supabaseMessage) {
  if (!supabaseMessage) return 'Something went wrong. Please try again.'

  const msg = supabaseMessage.toLowerCase()

  if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials'))
    return '이메일 주소 또는 비밀번호를 다시 확인해 주세요.'
  if (msg.includes('email not confirmed'))
    return 'EMAIL_NOT_CONFIRMED'   // special sentinel — UI handles this case
  if (msg.includes('token has expired') || msg.includes('otp expired'))
    return 'The verification code has expired. Please request a new one.'
  if (msg.includes('invalid otp') || msg.includes('token is invalid'))
    return 'Incorrect verification code. Please try again.'
  if (msg.includes('too many requests'))
    return 'Too many attempts. Please wait a moment and try again.'

  return supabaseMessage
}
