import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// A tiny in-memory stand-in for a Google Sheet, enough for the review paths.
function fakeSheet(rows, maxColumns) {
  const data = rows.map((row) => [...row])
  let maxCols = maxColumns
  const cell = (r, c) => {
    if (c > maxCols) throw new Error(`column ${c} is out of bounds (max ${maxCols})`)
    while (data.length < r) data.push([])
    return data[r - 1][c - 1] ?? ''
  }
  const sheet = {
    data,
    getMaxColumns: () => maxCols,
    insertColumnsAfter: (_after, count) => { maxCols += count },
    getLastRow: () => data.length,
    setFrozenRows: () => {},
    clearContents: () => { data.length = 0 },
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => cell(row + i, col + j))),
      setValues: (values) => values.forEach((line, i) => line.forEach((v, j) => {
        cell(row + i, col + j)
        data[row + i - 1][col + j - 1] = v
      })),
      setValue: (v) => {
        cell(row, col)
        data[row - 1][col - 1] = v
      },
      clearContent: () => {
        for (let i = 0; i < numRows; i++) {
          for (let j = 0; j < numCols; j++) {
            if (data[row + i - 1]) data[row + i - 1][col + j - 1] = ''
          }
        }
      },
    }),
    deleteColumns: (start, count) => {
      data.forEach((line) => line.splice(start - 1, count))
      maxCols -= count
    },
  }
  return sheet
}

async function loadScript(file, sheet, properties = {}) {
  const code = await readFile(file, 'utf8')
  const store = { MASTER_APPS_SCRIPT_SECRET: 'x'.repeat(40), PARTNER_APPS_SCRIPT_SECRET: 'x'.repeat(40), ...properties }
  const context = {
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet }),
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }),
    },
    Utilities: { formatDate: () => '10/11/2026' },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in store ? store[key] : 'x'.repeat(40)),
        setProperty: (key, value) => { store[key] = value },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => false, releaseLock() {} }) },
    console,
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  return context
}

const post = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ __uvain_shared_secret: 'x'.repeat(40), ...body }) } }))

test('master sheet v11: moves an old 47-column sheet once and keeps no identity data', async () => {
  const header = Array.from({ length: 47 }, (_, i) => `Old header ${i + 1}`)
  const oldRow = Array(47).fill('')
  oldRow[0] = '09/11/2026'          // scan date
  oldRow[2] = 'R1'                  // redemption id
  oldRow[4] = 'Cafe'                // place
  oldRow[6] = 'user-uuid-1'         // user_id
  oldRow[7] = 'Kim'                 // first name
  oldRow[12] = '12345678'           // student number
  oldRow[16] = 'female'             // gender
  oldRow[20] = '3/10'               // stamp progress
  oldRow[25] = 4                    // star rating
  oldRow[30] = 'great place'        // comment
  oldRow[34] = 'active'             // account status
  oldRow[45] = 'Old items'          // review items
  const sheet = fakeSheet([header, oldRow], 47)
  const ctx = await loadScript('scripts/apps-script/master-sheet.gs', sheet)

  // The first request moves the sheet, then does its own work.
  const result = post(ctx, {
    type: 'review', redemption_id: 'R1', rating: 5, tags: ['GREAT_FOOD', 'NICE_ATMOSPHERE'], comment: 'ignored',
    criteria: ['커피 맛', '공부하기 좋아요', '와이파이', '=가성비'], tag_labels: '커피 맛, 와이파이',
  })
  assert.equal(result.success, true, result.error)
  assert.equal(sheet.getMaxColumns(), 34)
  assert.equal(sheet.data[0][6], 'User ID')
  assert.equal(sheet.data[0][18], 'Review Items')
  const row = sheet.data[1]
  assert.equal(row[0], '09/11/2026')
  assert.equal(row[2], 'R1')
  assert.equal(row[6], 'user-uuid-1')
  assert.equal(row[8], '3/10')
  assert.equal(row[13], 5)
  assert.equal(row[14], 1)
  assert.equal(row[16], 1)
  assert.equal(row[18], '커피 맛, 와이파이')
  assert.equal(row[19], "커피 맛 / 공부하기 좋아요 / 와이파이 / '=가성비")
  assert.equal(row[23], 'active')
  const text = JSON.stringify(sheet.data)
  for (const leaked of ['Kim', '12345678', 'female', 'great place', 'ignored']) {
    assert.ok(!text.includes(leaked), `${leaked} must not be in the sheet`)
  }

  // Runs only once: a later scan resync uses the new layout and keeps items.
  assert.equal(post(ctx, { type: 'master', redemption_id: 'R1', user_id: 'user-uuid-1', first_name: 'Kim' }).success, true)
  assert.equal(sheet.getMaxColumns(), 34)
  assert.equal(sheet.data[1][18], '커피 맛, 와이파이')
  assert.ok(!JSON.stringify(sheet.data).includes('Kim'))

  // An old app version (no criteria) still works and leaves the cells alone.
  assert.equal(post(ctx, { type: 'review', redemption_id: 'R1', rating: 5, tags: [] }).success, true)
  assert.equal(sheet.data[1][18], '커피 맛, 와이파이')

  // Privacy anonymization still finds the member by user_id.
  assert.equal(post(ctx, { type: 'privacy_anonymize', user_id: 'user-uuid-1' }).success, true)
  assert.equal(sheet.data[1][6], '---')
  assert.equal(sheet.data[1][23], 'anonymized')
})

test('master sheet v11: an empty sheet gets the v11 headers', async () => {
  const sheet = fakeSheet([], 34)
  const ctx = await loadScript('scripts/apps-script/master-sheet.gs', sheet)
  assert.equal(post(ctx, { type: 'master', redemption_id: 'R2', user_id: 'u2' }).success, true)
  assert.equal(sheet.data[0][0], 'Scan Date')
  assert.equal(sheet.data[1][2], 'R2')
  assert.equal(sheet.data[1][6], 'u2')
})

test('partner sheet: labels the 4 tag columns with the place names', async () => {
  const header = ['Scan Date', 'Redemption ID', '', '', '', '', '', '', '', '', '', '', '', '', 'Created At [Date]', 'Updated At [Date]']
  const sheet = fakeSheet([header], 16)
  const code = (await readFile('scripts/apps-script/partner-owner.gs', 'utf8'))
    .replace("const PARTNERSHIP_ID = 'REPLACE_WITH_PARTNERSHIP_ID';", "const PARTNERSHIP_ID = 'P1';")
  const { writeFile, rm, mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(`${tmpdir()}/partner-gs-`)
  const file = `${dir}/partner-owner.gs`
  await writeFile(file, code)
  try {
    const ctx = await loadScript(file, sheet)
    const result = post(ctx, {
      type: 'review', partnership_id: 'P1', redemption_id: 'R9', rating: 4, tags: ['GOOD_VALUE'],
      criteria: ['커피 맛', '공부하기 좋아요', '와이파이', '가성비'], tag_labels: '가성비',
    })
    assert.equal(result.success, true, result.error)
    assert.deepEqual(sheet.data[0].slice(8, 12), ['커피 맛', '공부하기 좋아요', '와이파이', '가성비'])
    assert.equal(sheet.data[1][11], 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
