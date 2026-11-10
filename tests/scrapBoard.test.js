import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  REVIEW_BOX_TYPES,
  SCRAP_MAX_ITEMS,
  SCRAP_MIN_HEIGHT,
  SCRAP_WIDTH,
  getReviewBoxType,
  isAllowedScrapImageSrc,
  normalizeScrapBoard,
  placeImagePrefix,
  scrapImageUrls,
} from '../src/domain/scrapBoard.js'

const prefix = placeImagePrefix('https://abc.supabase.co/')
const photo = (name, extra = {}) => ({ id: name, t: 'img', src: prefix + name, x: 10, y: 10, w: 100, h: 80, ...extra })

test('낙서장: unknown or missing review box type falls back to 우슐랭', () => {
  assert.equal(getReviewBoxType({}), REVIEW_BOX_TYPES.USULLANG)
  assert.equal(getReviewBoxType({ review_box_type: 'nope' }), REVIEW_BOX_TYPES.USULLANG)
  assert.equal(getReviewBoxType({ review_box_type: 'scrap_rating' }), REVIEW_BOX_TYPES.SCRAP_RATING)
})

test('낙서장: photos must come from this project\'s place-images bucket', () => {
  assert.equal(prefix, 'https://abc.supabase.co/storage/v1/object/public/place-images/')
  assert.ok(isAllowedScrapImageSrc(prefix + 'a1.webp', prefix))
  assert.ok(!isAllowedScrapImageSrc('https://evil.example.com/a.png', prefix))
  assert.ok(!isAllowedScrapImageSrc(prefix + '../secret/a.png', prefix))
  assert.ok(!isAllowedScrapImageSrc('blob:https://app/x', prefix))
  assert.ok(isAllowedScrapImageSrc('blob:https://app/x', prefix, { allowBlob: true }))
  assert.ok(!isAllowedScrapImageSrc(prefix + 'a.webp', null))
})

test('낙서장: board is cleaned, clamped and limited', () => {
  const board = normalizeScrapBoard({
    h: 10,
    extra: 'dropped',
    items: [
      photo('a.webp', { w: 99999, x: -5000, onClick: 'x' }),
      { id: 'bad', t: 'img', src: 'https://evil.example.com/t.png', x: 0, y: 0, w: 10, h: 10 },
      { id: 't', t: 'text', text: 'x'.repeat(900), fs: 400, c: 'red', x: 9999, y: -3, w: 5 },
      { id: 'h', t: 'html', html: '<script>' },
      'nope',
    ],
  }, { prefix })
  assert.deepEqual(Object.keys(board), ['v', 'h', 'items'])
  assert.equal(board.h, SCRAP_MIN_HEIGHT)
  assert.equal(board.items.length, 2)
  const [img, text] = board.items
  assert.equal(img.w, 700)
  assert.ok(img.x >= -(img.w - 16))
  assert.equal(img.onClick, undefined)
  assert.equal(text.text.length, 500)
  assert.equal(text.fs, 48)
  assert.equal(text.c, '#1f2937')
  assert.ok(text.x <= SCRAP_WIDTH - 16)
  assert.equal(text.y, 0)
  assert.equal(text.w, 40)

  const many = normalizeScrapBoard({ items: Array.from({ length: 90 }, (_, i) => photo(`p${i}.webp`)) }, { prefix })
  assert.equal(many.items.length, SCRAP_MAX_ITEMS)
  assert.deepEqual(normalizeScrapBoard(null), { v: 1, h: SCRAP_MIN_HEIGHT, items: [] })
  assert.deepEqual(scrapImageUrls(many).length, SCRAP_MAX_ITEMS)
})

test('낙서장: duplicate item ids are made unique', () => {
  const board = normalizeScrapBoard({ items: [photo('a.webp', { id: 'x' }), photo('b.webp', { id: 'x' })] }, { prefix })
  assert.notEqual(board.items[0].id, board.items[1].id)
})

test('낙서장: DB keeps the type list and a size limit; SpotCard and admin use them', async () => {
  const sql = await readFile('supabase/migrations/20261110130000_scrap_paper_review_box.sql', 'utf8')
  assert.match(sql, /review_box_type text NOT NULL DEFAULT 'usullang'/)
  assert.match(sql, /'usullang'::text, 'scrap'::text, 'scrap_rating'::text/)
  assert.match(sql, /jsonb_array_length\(scrap_board -> 'items'\) <= 60/)
  assert.match(sql, /pg_column_size\(scrap_board\) <= 65536/)
  const card = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(card, /normalizeScrapBoard\(selected\.scrap_board, \{ prefix: SCRAP_IMAGE_PREFIX \}\)/)
  assert.match(card, /scrap-pill/)
  const admin = await readFile('src/pages/AdminPage.jsx', 'utf8')
  assert.match(admin, /review_box_type: getReviewBoxType\(form\)/)
  // New board photos upload only when the place is saved; removed ones are deleted after.
  assert.match(admin, /item\.src\.startsWith\('blob:'\)/)
  assert.match(admin, /await removePlaceImages\(uploadedScrapUrls\)/)
})
