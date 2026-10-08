import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAppEnv } from '../src/lib/resolveAppEnv.js'

test('allows development behavior only in local Vite development', () => {
  assert.equal(resolveAppEnv({ isViteDev: true, configuredEnv: 'development' }), 'development')
})

test('uses production behavior for deployed builds even if the variable says development', () => {
  assert.equal(resolveAppEnv({ isViteDev: false, configuredEnv: 'development' }), 'production')
})

test('uses production behavior when the environment variable is missing or unexpected', () => {
  assert.equal(resolveAppEnv({ isViteDev: true, configuredEnv: undefined }), 'production')
  assert.equal(resolveAppEnv({ isViteDev: true, configuredEnv: 'staging' }), 'production')
})
