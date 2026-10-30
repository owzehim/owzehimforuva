import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'))
  .split("createRoot(document.getElementById('root'))")[0]
  .replace(/^import .*\r?\n/gm, '')

function runRegistration({ supported = true, rejectUpdate = false } = {}) {
  let options
  let interval
  let reloads = 0
  let activations = 0
  let checks = 0
  let warnings = 0
  const worker = new EventTarget()
  const document = new EventTarget()
  document.visibilityState = 'visible'
  vm.runInNewContext(source, {
    navigator: supported ? { serviceWorker: worker } : {}, document,
    window: { location: { reload: () => reloads++ } },
    registerSW: value => { options = value; return () => activations++ },
    setInterval: (callback, milliseconds) => { interval = { callback, milliseconds } },
    console: { warn: () => warnings++, error() {} },
  })
  const registration = { update: async () => { checks++; if (rejectUpdate) throw new Error('offline') } }
  return {
    worker, document, registration, options, get interval() { return interval },
    get reloads() { return reloads }, get activations() { return activations },
    get checks() { return checks }, get warnings() { return warnings },
  }
}

test('first install and waiting updates never request activation or reload the active page', () => {
  const f = runRegistration()
  assert.equal(f.options.immediate, true)
  f.worker.dispatchEvent(new Event('controllerchange'))
  f.options.onNeedRefresh?.()
  f.worker.dispatchEvent(new Event('controllerchange'))
  assert.equal(f.reloads, 0)
  assert.equal(f.activations, 0)
})

test('update downloads are checked on startup, hourly and on return, without activating them', () => {
  const f = runRegistration()
  f.options.onRegisteredSW('/sw.js', f.registration)
  assert.equal(f.checks, 1)
  assert.equal(f.interval.milliseconds, 60 * 60 * 1000)
  f.interval.callback()
  f.document.visibilityState = 'hidden'
  f.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.checks, 2)
  f.document.visibilityState = 'visible'
  f.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.checks, 3)
  assert.equal(f.activations, 0)
  assert.equal(f.reloads, 0)
})

test('offline update checks and browsers without workers remain usable', async () => {
  assert.equal(runRegistration({ supported: false }).options, undefined)
  const f = runRegistration({ rejectUpdate: true })
  f.options.onRegisteredSW('/sw.js', f.registration)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.warnings, 1)
  assert.equal(f.reloads, 0)
})
