// OPS-17: the "새로운 업데이트가 있어요!" card.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyWaitingUpdate,
  isUpdatePromptHiddenOn,
  isUpdateReady,
  markUpdateReady,
  onUpdateReady,
} from '../src/lib/appUpdate.js'

test('nothing is applied until a waiting version is reported and the member taps', () => {
  assert.equal(applyWaitingUpdate(), false)
  let applied = 0
  let notified = 0
  const stop = onUpdateReady(() => notified++)
  markUpdateReady(() => applied++)
  assert.equal(isUpdateReady(), true)
  assert.equal(notified, 1)
  assert.equal(applied, 0, 'reporting a waiting version must not activate it')
  assert.equal(applyWaitingUpdate(), true)
  assert.equal(applied, 1)
  stop()
})

test('the card stays away from scan, sign-in, sign-up, password and policy screens', () => {
  for (const path of ['/scan', '/login', '/register', '/reset-password', '/settings/password', '/legal-consent', '/email-confirmed']) {
    assert.equal(isUpdatePromptHiddenOn(path), true, path)
  }
  for (const path of ['/member', '/admin', '/settings', '/public']) {
    assert.equal(isUpdatePromptHiddenOn(path), false, path)
  }
})

test('the card uses the agreed text and the policy screen marks itself', () => {
  const card = readFileSync('src/components/UpdatePrompt.jsx', 'utf8')
  assert.ok(card.includes('새로운 업데이트가 있어요!'))
  assert.ok(card.includes('나중에'))
  assert.ok(card.includes('업데이트'))
  assert.ok(readFileSync('src/pages/LegalConsentPage.jsx', 'utf8').includes('data-legal-consent-screen'))
})
