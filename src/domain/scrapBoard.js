// ─────────────────────────────────────────────────────────────
// 낙서장 (Scrap paper) board model
//
// A board is stored in restaurants.scrap_board as JSON. Items use a fixed
// logical width (SCRAP_WIDTH) so the board looks the same on every screen;
// viewers scale it to the box width. The board only grows downward.
// ─────────────────────────────────────────────────────────────

export const REVIEW_BOX_TYPES = Object.freeze({
  USULLANG: 'usullang',
  SCRAP: 'scrap',
  SCRAP_RATING: 'scrap_rating',
})

export const REVIEW_BOX_TYPE_OPTIONS = [
  { value: REVIEW_BOX_TYPES.USULLANG, label: '우슐랭' },
  { value: REVIEW_BOX_TYPES.SCRAP, label: '낙서장' },
  { value: REVIEW_BOX_TYPES.SCRAP_RATING, label: '낙서장 + 멤버 평가' },
]

export const SCRAP_WIDTH = 350
export const SCRAP_LINE = 28
export const SCRAP_MARGIN_X = 34
export const SCRAP_MIN_HEIGHT = 380
export const SCRAP_MAX_HEIGHT = 6000
export const SCRAP_MAX_ITEMS = 60
export const SCRAP_TEXT_MAX = 500
export const SCRAP_FONT_MIN = 10
export const SCRAP_FONT_MAX = 48
export const SCRAP_IMAGE_MIN = 24
export const SCRAP_IMAGE_MAX = 700
export const SCRAP_TEXT_MIN_WIDTH = 40
export const SCRAP_COLORS = ['#1f2937', '#ef4444', '#2563eb', '#f97316', '#16a34a', '#7c3aed']

const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

export function getReviewBoxType(place) {
  const value = place?.review_box_type
  return Object.values(REVIEW_BOX_TYPES).includes(value) ? value : REVIEW_BOX_TYPES.USULLANG
}

export function isScrapReviewBox(type) {
  return type === REVIEW_BOX_TYPES.SCRAP || type === REVIEW_BOX_TYPES.SCRAP_RATING
}

export function emptyScrapBoard() {
  return { v: 1, h: SCRAP_MIN_HEIGHT, items: [] }
}

/** Public URL prefix of the place-images bucket for a Supabase project URL. */
export function placeImagePrefix(supabaseUrl) {
  if (!supabaseUrl) return null
  return `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/place-images/`
}

/** Board photos must live in this project's place-images bucket (or be a local preview while editing). */
export function isAllowedScrapImageSrc(src, prefix, { allowBlob = false } = {}) {
  if (typeof src !== 'string' || src.length > 600) return false
  if (allowBlob && src.startsWith('blob:')) return true
  if (!prefix || !src.startsWith(prefix)) return false
  const fileName = src.slice(prefix.length)
  return /^[A-Za-z0-9._-]{1,200}$/.test(fileName)
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const round1 = (value) => Math.round(value * 10) / 10

function normalizeItem(raw, index, options) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && ITEM_ID_PATTERN.test(raw.id) ? raw.id : `item-${index}`
  const r = clamp(round1(num(raw.r)), -45, 45)

  if (raw.t === 'img') {
    if (!isAllowedScrapImageSrc(raw.src, options.prefix, { allowBlob: options.allowBlob })) return null
    const w = clamp(round1(num(raw.w, 160)), SCRAP_IMAGE_MIN, SCRAP_IMAGE_MAX)
    const h = clamp(round1(num(raw.h, 120)), SCRAP_IMAGE_MIN, SCRAP_IMAGE_MAX)
    return {
      id,
      t: 'img',
      src: raw.src,
      x: clamp(round1(num(raw.x)), -(w - 16), SCRAP_WIDTH - 16),
      y: clamp(round1(num(raw.y)), 0, SCRAP_MAX_HEIGHT - 16),
      w,
      h,
      r,
    }
  }

  if (raw.t === 'text') {
    const text = typeof raw.text === 'string' ? raw.text.slice(0, SCRAP_TEXT_MAX) : ''
    const w = clamp(round1(num(raw.w, 240)), SCRAP_TEXT_MIN_WIDTH, SCRAP_WIDTH)
    return {
      id,
      t: 'text',
      text,
      x: clamp(round1(num(raw.x)), -(w - 16), SCRAP_WIDTH - 16),
      y: clamp(round1(num(raw.y)), 0, SCRAP_MAX_HEIGHT - 16),
      w,
      fs: clamp(Math.round(num(raw.fs, 15)), SCRAP_FONT_MIN, SCRAP_FONT_MAX),
      c: SCRAP_COLORS.includes(raw.c) ? raw.c : SCRAP_COLORS[0],
      b: raw.b === true,
      r,
    }
  }

  return null
}

/**
 * Returns a safe board: unknown fields dropped, numbers clamped, photos
 * outside the place-images bucket removed, at most SCRAP_MAX_ITEMS items.
 */
export function normalizeScrapBoard(raw, { prefix = null, allowBlob = false } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawItems = Array.isArray(source.items) ? source.items.slice(0, SCRAP_MAX_ITEMS) : []
  const seen = new Set()
  const items = []
  rawItems.forEach((rawItem, index) => {
    const item = normalizeItem(rawItem, index, { prefix, allowBlob })
    if (!item) return
    if (seen.has(item.id)) item.id = `${item.id}-${index}`
    seen.add(item.id)
    items.push(item)
  })
  return {
    v: 1,
    h: clamp(Math.round(num(source.h, SCRAP_MIN_HEIGHT)), SCRAP_MIN_HEIGHT, SCRAP_MAX_HEIGHT),
    items,
  }
}

/** Lowest point used by any item, in logical pixels. */
export function scrapContentBottom(board) {
  return (board?.items || []).reduce((bottom, item) => {
    const height = item.t === 'img' ? item.h : estimateTextHeight(item)
    return Math.max(bottom, item.y + height)
  }, 0)
}

export function scrapTextLineHeight(fontSize) {
  return fontSize <= 20 ? SCRAP_LINE : Math.ceil((fontSize * 1.3) / (SCRAP_LINE / 2)) * (SCRAP_LINE / 2)
}

export function estimateTextHeight(item) {
  const lineHeight = scrapTextLineHeight(item.fs)
  const charsPerLine = Math.max(1, Math.floor(item.w / (item.fs * 0.95)))
  const lines = String(item.text || '')
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
  return lines * lineHeight
}

export function scrapImageUrls(board) {
  return (board?.items || []).filter((item) => item.t === 'img').map((item) => item.src)
}

export function hasScrapContent(board) {
  return Array.isArray(board?.items) && board.items.length > 0
}
