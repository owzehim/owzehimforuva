import test from 'node:test'
import assert from 'node:assert/strict'
import { getCaptchaOptions } from '../src/lib/captcha.js'

test('CAPTCHA options are omitted until a site key is configured', () => {
  assert.deepEqual(getCaptchaOptions('', ''), {})
})

test('CAPTCHA-enabled auth requests fail closed without a verified token', () => {
  assert.throws(
    () => getCaptchaOptions('', 'configured-site-key'),
    /자동 확인을 완료한 뒤 다시 시도해주세요/,
  )
})

test('verified CAPTCHA token is trimmed and returned in Supabase Auth shape', () => {
  assert.deepEqual(getCaptchaOptions(' token-value ', 'configured-site-key'), {
    captchaToken: 'token-value',
  })
})
