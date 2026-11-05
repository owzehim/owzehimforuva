import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeIcsText, getSafeHttpsUrl } from '../src/lib/sanitizeHtml.js'

const memberPage = readFileSync(new URL('../src/pages/MemberPage.jsx', import.meta.url), 'utf8')

test('external links require HTTPS and reject embedded credentials', () => {
  assert.equal(getSafeHttpsUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(getSafeHttpsUrl('javascript:alert(1)'), null)
  assert.equal(getSafeHttpsUrl('http://example.com'), null)
  assert.equal(getSafeHttpsUrl('https://user:password@example.com'), null)
})

test('event Instagram links use the HTTPS-only URL validator at both render sites', () => {
  assert.match(memberPage, /const safeInstagramUrl = getSafeHttpsUrl\(displayEvent\?\.instagram_url\)/)
  assert.equal((memberPage.match(/href=\{safeInstagramUrl\}/g) || []).length, 2)
  assert.doesNotMatch(memberPage, /href=\{displayEvent\.instagram_url\}/)
})

test('calendar text escapes separators, slashes, and line breaks', () => {
  assert.equal(escapeIcsText('Cafe, \r\nSUMMARY:Injected;\\'), 'Cafe\\, \\nSUMMARY:Injected\\;\\\\')
})
