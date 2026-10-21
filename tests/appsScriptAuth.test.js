import test from 'node:test'
import assert from 'node:assert/strict'
import { getAllowedAppsScriptUrl } from '../supabase/functions/_shared/appsScriptAuth.js'

test('accepts HTTPS Google Apps Script deployment URLs only', () => {
  assert.equal(
    getAllowedAppsScriptUrl('https://script.google.com/macros/s/AKfycbx123/exec'),
    'https://script.google.com/macros/s/AKfycbx123/exec',
  )
  assert.equal(
    getAllowedAppsScriptUrl('https://script.google.com/macros/s/AKfycbx123/exec/'),
    'https://script.google.com/macros/s/AKfycbx123/exec/',
  )
})

test('rejects non-Google, non-HTTPS, and decorated Apps Script URLs', () => {
  assert.equal(getAllowedAppsScriptUrl('http://script.google.com/macros/s/abc/exec'), null)
  assert.equal(getAllowedAppsScriptUrl('https://script.google.com.evil.example/macros/s/abc/exec'), null)
  assert.equal(getAllowedAppsScriptUrl('https://example.com/macros/s/abc/exec'), null)
  assert.equal(getAllowedAppsScriptUrl('https://user:pass@script.google.com/macros/s/abc/exec'), null)
  assert.equal(getAllowedAppsScriptUrl('https://script.google.com/macros/s/abc/exec?redirect=https://evil.example'), null)
  assert.equal(getAllowedAppsScriptUrl('https://script.google.com/'), null)
  assert.equal(getAllowedAppsScriptUrl('not a url'), null)
})
