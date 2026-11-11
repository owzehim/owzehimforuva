// GDPR-04: the "내 정보 다운로드" export.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MEMBER_EXPORT_SECTIONS,
  collectMemberData,
  exportableAuthMetadata,
  referencedPlaceIds,
  referencedStoreIds,
} from '../supabase/functions/_shared/memberDataExport.js'

const USER = '11111111-1111-4111-8111-111111111111'

test('the export covers the member data tables', () => {
  const tables = new Set(MEMBER_EXPORT_SECTIONS.map((section) => section.table))
  for (const table of ['members', 'legal_consent_receipts', 'redemptions', 'stamp_card_visits', 'stamp_card_rewards', 'reviews', 'restaurant_notes', 'restaurant_comments', 'member_analytics_profiles']) {
    assert.ok(tables.has(table), table)
  }
})

test('no internal secrets or other people’s details are exported', () => {
  const columns = MEMBER_EXPORT_SECTIONS.flatMap((section) => section.columns.split(',').map((c) => c.trim()))
  for (const forbidden of ['session_token', 'sheet_member_ref', 'reporter_email', 'reporter_name', 'content_author_email', 'content_author_name_snapshot', 'reviewed_by', 'archived_by', 'secret']) {
    assert.ok(!columns.includes(forbidden), forbidden)
  }
})

test('every query is limited to the requesting member', async () => {
  const seen = []
  const admin = {
    from(table) {
      const query = {
        select: () => query,
        order: () => query,
        range: () => query,
        eq: (column, value) => { seen.push({ table, column, value }); return query },
        maybeSingle: async () => ({ data: { table }, error: null }),
        then: (resolve) => resolve({ data: [{ restaurant_id: 'r1', store_id: 's1' }], error: null }),
      }
      return query
    },
  }
  const data = await collectMemberData(admin, USER)
  assert.equal(seen.length, MEMBER_EXPORT_SECTIONS.length)
  for (const call of seen) assert.equal(call.value, USER, `${call.table}.${call.column}`)
  assert.deepEqual(data.profile, { table: 'members' })
  assert.deepEqual(referencedPlaceIds(data), ['r1'])
  assert.deepEqual(referencedStoreIds(data), ['s1'])
})

test('a database error stops the export instead of sending partial data', async () => {
  const admin = {
    from() {
      const query = {
        select: () => query,
        order: () => query,
        range: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: null, error: { message: 'down' } }),
        then: (resolve) => resolve({ data: null, error: { message: 'down' } }),
      }
      return query
    },
  }
  await assert.rejects(collectMemberData(admin, USER))
})

test('the Edge Function checks login, device and a rate limit', () => {
  const source = readFileSync('supabase/functions/export-my-data/index.ts', 'utf8')
  assert.ok(source.includes('hasVerifiedAppLogin(token, user.id)'))
  assert.ok(source.includes('hasActiveDeviceSession(admin, user.id, token)'))
  assert.ok(source.includes("rpc('consume_edge_rate_limit'"))
  assert.ok(readFileSync('src/pages/SettingsPage.jsx', 'utf8').includes('내 정보 다운로드'))
})

test('GDPR-24: long lists are read page by page, never cut off', async () => {
  const ROWS = 7
  const admin = {
    from(table) {
      let range = [0, 999]
      const query = {
        select: () => query,
        order: () => query,
        eq: () => query,
        range: (from, to) => { range = [from, to]; return query },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve) => {
          const rows = table === 'redemptions'
            ? Array.from({ length: ROWS }, (_, i) => ({ id: i })).slice(range[0], range[1] + 1)
            : []
          return resolve({ data: rows, error: null })
        },
      }
      return query
    },
  }
  const data = await collectMemberData(admin, USER, 3)
  assert.equal(data.check_ins.length, ROWS)
})

test('GDPR-24: account sign-up details are exported without secret-looking fields', () => {
  const out = exportableAuthMetadata({
    registration: { first_name: 'Min', legal_documents: { terms: 'v1' }, returnToken: 'x' },
    otp_hash: 'y',
    password_set: true,
  })
  assert.deepEqual(out, { registration: { first_name: 'Min', legal_documents: { terms: 'v1' } } })
  assert.deepEqual(exportableAuthMetadata(null), {})
})
