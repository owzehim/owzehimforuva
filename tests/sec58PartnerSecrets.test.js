// SEC-58: each partner sheet gets its own Apps Script secret.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getPartnerAppsScriptSecret } from '../supabase/functions/_shared/partnerAppsScriptSecret.js'

const SHARED = 's'.repeat(40)
const OWN = 'a'.repeat(64)

function fakeAdmin(rows, { fail = false } = {}) {
  return {
    from(table) {
      assert.equal(table, 'partnership_apps_script_secrets')
      const filters = {}
      const query = {
        select: () => query,
        eq: (column, value) => { filters[column] = value; return query },
        maybeSingle: async () => fail
          ? { data: null, error: { message: 'down' } }
          : {
              data: rows.find((row) => row.partnership_id === filters.partnership_id && row.enabled === filters.enabled) ?? null,
              error: null,
            },
      }
      return query
    },
  }
}

test('an enabled partner uses its own secret', async () => {
  const admin = fakeAdmin([{ partnership_id: 'A', secret: OWN, enabled: true }])
  assert.equal(await getPartnerAppsScriptSecret(admin, 'A', SHARED), OWN)
})

test('a partner not switched over yet keeps the shared secret', async () => {
  const admin = fakeAdmin([{ partnership_id: 'A', secret: OWN, enabled: false }])
  assert.equal(await getPartnerAppsScriptSecret(admin, 'A', SHARED), SHARED)
  assert.equal(await getPartnerAppsScriptSecret(admin, 'B', SHARED), SHARED)
})

test("one partner's secret is never used for another partner", async () => {
  const admin = fakeAdmin([{ partnership_id: 'A', secret: OWN, enabled: true }])
  assert.equal(await getPartnerAppsScriptSecret(admin, 'B', SHARED), SHARED)
})

test('lookup failures or bad rows fall back safely', async () => {
  assert.equal(await getPartnerAppsScriptSecret(fakeAdmin([], { fail: true }), 'A', SHARED), SHARED)
  const short = fakeAdmin([{ partnership_id: 'A', secret: 'short', enabled: true }])
  assert.equal(await getPartnerAppsScriptSecret(short, 'A', SHARED), SHARED)
  assert.equal(await getPartnerAppsScriptSecret(fakeAdmin([]), '', SHARED), SHARED)
})

test('the secrets table is server-only and every partner gets a random secret', () => {
  const sql = readFileSync('supabase/migrations/20261106010000_sec58_partner_apps_script_secrets.sql', 'utf8')
  assert.ok(sql.includes('ALTER TABLE public.partnership_apps_script_secrets ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('REVOKE ALL ON TABLE public.partnership_apps_script_secrets FROM PUBLIC, anon, authenticated'))
  assert.ok(sql.includes('enabled boolean NOT NULL DEFAULT false'))
  assert.equal((sql.match(/encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/g) || []).length, 2)
})

test('all three partner senders use the per-partner secret', () => {
  for (const fn of ['log-redemption', 'redeem-stamp-card-reward', 'sync-to-sheets']) {
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8')
    assert.ok(source.includes('getPartnerAppsScriptSecret(admin'), fn)
  }
})
