import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAppEnv } from '../src/lib/resolveAppEnv.js'

test('development behavior requires both a local Vite dev server and explicit opt-in', () => {
  assert.equal(resolveAppEnv({ isViteDev: true, configuredEnv: 'development' }), 'development')
  assert.equal(resolveAppEnv({ isViteDev: true, configuredEnv: undefined }), 'production')
  assert.equal(resolveAppEnv({ isViteDev: false, configuredEnv: 'development' }), 'production')
  assert.equal(resolveAppEnv({ isViteDev: false, configuredEnv: 'production' }), 'production')
  assert.equal(resolveAppEnv({ isViteDev: false, configuredEnv: 'staging' }), 'production')
})
