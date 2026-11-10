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
      clearContent: () => {},
    }),
  }
  return sheet
}

async function loadScript(file, sheet) {
  const code = await readFile(file, 'utf8')
  const context = {
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet }),
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }),
    },
    Utilities: { formatDate: () => '10/11/2026' },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x'.repeat(40) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => false, releaseLock() {} }) },
    console,
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  return context
}

const post = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ __uvain_shared_secret: 'x'.repeat(40), ...body }) } }))

test('master sheet: adds the 2 review item columns and fills them from a review', async () => {
  const header = Array.from({ length: 45 }, (_, i) => `My header ${i + 1}`)
  const scanRow = Array(45).fill('')
  scanRow[2] = 'R1'
  const sheet = fakeSheet([header, scanRow], 45)
  const ctx = await loadScript('scripts/apps-script/master-sheet.gs', sheet)

  const result = post(ctx, {
    type: 'review', redemption_id: 'R1', rating: 4, tags: ['GREAT_FOOD', 'NICE_ATMOSPHERE'], comment: '',
    criteria: ['커피 맛', '공부하기 좋아요', '와이파이', '=가성비'], tag_labels: '커피 맛, 와이파이',
  })
  assert.equal(result.success, true, result.error)
  assert.equal(sheet.getMaxColumns(), 47)
  assert.equal(sheet.data[0][0], 'My header 1', 'renamed headers are kept')
  assert.equal(sheet.data[0][45], 'Review Items')
  assert.equal(sheet.data[1][26], 1)
  assert.equal(sheet.data[1][28], 1)
  assert.equal(sheet.data[1][45], '커피 맛, 와이파이')
  assert.equal(sheet.data[1][46], "커피 맛 / 공부하기 좋아요 / 와이파이 / '=가성비")

  // A later scan resync of the same redemption keeps the review item cells.
  assert.equal(post(ctx, { type: 'master', redemption_id: 'R1' }).success, true)
  assert.equal(sheet.data[1][45], '커피 맛, 와이파이')

  // An old app version (no criteria) still works and leaves the cells alone.
  assert.equal(post(ctx, { type: 'review', redemption_id: 'R1', rating: 5, tags: [] }).success, true)
  assert.equal(sheet.data[1][45], '커피 맛, 와이파이')
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
