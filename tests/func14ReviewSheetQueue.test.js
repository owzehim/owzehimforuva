// FUNC-14: review Sheet rows are queued and retried like check-ins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReviewSheetPayloads } from '../supabase/functions/_shared/reviewSheetPayload.js'

const read = (file) => readFileSync(file, 'utf8')

test('review rows: no comment or identity, the review\'s own date, place criteria names', () => {
  const { master, partner } = buildReviewSheetPayloads({
    storeId: 'Cafe_1',
    partnership: { name: 'Cafe', sheet_name: '=Cafe' },
    redemptionId: 211,
    review: { rating: 4, tags: ['GREAT_FOOD', 'BOGUS', 'GOOD_VALUE'], created_at: '2026-11-13T15:27:22Z', comment: 'secret text', user_id: 'u1' },
    placeCriteria: null,
    now: new Date('2026-12-01T10:00:00Z'),
  })
  assert.equal(master.type, 'review')
  assert.equal(master.redemption_id, '211')
  assert.deepEqual(master.tags, ['GREAT_FOOD', 'GOOD_VALUE'])
  assert.equal(master.tag_labels, 'Great food, Good value')
  assert.equal(master.comment, '')
  assert.equal(master.sheet_name, "'=Cafe", 'formula-looking text is escaped')
  // A retry keeps the date the review was written, not the retry time.
  assert.equal(master.review_submitted_at_date, '13/11/2026')
  assert.equal(master.review_submitted_at_time, '16:27')
  assert.equal(partner.review_submitted_at_date, '13/11/2026')
  assert.equal(partner.review_submitted_at_time, undefined)
  for (const row of [master, partner]) {
    const text = JSON.stringify(row)
    assert.ok(!text.includes('secret text'))
    assert.ok(!text.includes('u1'))
  }
})

test('review queue: server-only table, cleared with the check-in', () => {
  const sql = read('supabase/migrations/20261113140000_func14_review_sheet_queue.sql')
  assert.match(sql, /ALTER TABLE public\.review_sheet_queue ENABLE ROW LEVEL SECURITY;/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.review_sheet_queue FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /REFERENCES public\.redemptions\(id\) ON DELETE CASCADE/)
  assert.match(sql, /UNIQUE \(redemption_id, target\)/)
  assert.ok(!/comment|user_id|rating/.test(sql.replace(/^--.*$/gm, '')), 'no review content or member id in the queue')
})

test('sync-to-sheets queues the review instead of posting once; the retry job covers reviews', () => {
  const fn = read('supabase/functions/sync-to-sheets/index.ts')
  assert.match(fn, /queueAndSendReviewSheetRows\(admin, \{/)
  assert.ok(!fn.includes('fetch(endpoint'), 'no direct one-shot Apps Script call left')
  assert.match(fn, /sheets: pending === 0 \? 'sent' : 'queued'/)
  const sync = read('supabase/functions/_shared/reviewSheetSync.ts')
  assert.match(sync, /if \(!review \|\| review\.store_id !== row\.store_id\) return \{ ok: false, drop: true \}/)
  const job = read('supabase/functions/privacy-retention-sync/index.ts')
  assert.match(job, /retryReviewSheetRows\(admin, \{ limit: 20, deadline: startedAt \+ 65_000 \}\)/)
  assert.match(job, /review_stuck_count: reviews\.stuck/)
  // Check-ins are retried first: a review needs its check-in row in the Master.
  assert.ok(job.indexOf('retryCheckinSheetRows(admin') < job.indexOf('retryReviewSheetRows(admin'))
})

test('LEG-10: no low-contrast #9ca3af text left except the disabled note button', () => {
  const files = ['src/components/ReviewModal.jsx', 'src/features/stampCard/components/StampCardEditPanel.jsx',
    'src/features/stampCard/components/StampCardMemberPanel.jsx', 'src/pages/AdminPage.jsx']
  for (const file of files) assert.ok(!read(file).toLowerCase().includes('#9ca3af'), file)
  // Light-mode grey text is darkened globally (4.8:1).
  assert.match(read('src/index.css'), /html:not\(\.dark\) \.text-gray-400 \{\s*color: #6b7280;/)
})
