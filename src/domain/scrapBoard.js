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
export const SCRAP_PEN_WIDTHS = [2, 4, 8]
export const SCRAP_MAX_STROKES = 200
export const SCRAP_MAX_STROKE_CHARS = 6000
// The DB allows 64 KB; keep the JSON comfortably under it.
export const SCRAP_MAX_BOARD_CHARS = 56000

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

const POINTS_PATTERN = /^-?\d{1,4}(\.\d)?,-?\d{1,4}(\.\d)?( -?\d{1,4}(\.\d)?,-?\d{1,4}(\.\d)?)*$/

function normalizeStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return null
  if (typeof stroke.p !== 'string' || stroke.p.length > SCRAP_MAX_STROKE_CHARS || !POINTS_PATTERN.test(stroke.p)) return null
  return {
    c: SCRAP_COLORS.includes(stroke.c) ? stroke.c : SCRAP_COLORS[0],
    sw: clamp(round1(num(stroke.sw, 4)), 1, 24),
    p: stroke.p,
  }
}

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

  if (raw.t === 'draw') {
    const vw = clamp(round1(num(raw.vw, 0)), 1, 4000)
    const vh = clamp(round1(num(raw.vh, 0)), 1, 4000)
    const strokes = (Array.isArray(raw.s) ? raw.s.slice(0, SCRAP_MAX_STROKES) : [])
      .map((stroke) => normalizeStroke(stroke))
      .filter(Boolean)
    if (strokes.length === 0) return null
    const w = clamp(round1(num(raw.w, vw)), 4, SCRAP_WIDTH * 2)
    const h = clamp(round1(num(raw.h, vh)), 4, SCRAP_MAX_HEIGHT)
    return {
      id,
      t: 'draw',
      x: clamp(round1(num(raw.x)), -(w - 16), SCRAP_WIDTH - 16),
      y: clamp(round1(num(raw.y)), 0, SCRAP_MAX_HEIGHT - 16),
      w,
      h,
      vw,
      vh,
      s: strokes,
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
    const height = item.t === 'text' ? estimateTextHeight(item) : item.h
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

// ── Freehand drawing ─────────────────────────────────────────
// A drawing item holds strokes in its own box (vw × vh) and is shown at
// w × h, so it moves and resizes like a photo. Points are stored as a
// compact "x,y x,y" string with one decimal.

export function encodePoints(points) {
  return points.map(([x, y]) => `${round1(x)},${round1(y)}`).join(' ')
}

export function decodePoints(text) {
  if (typeof text !== 'string' || !text) return []
  return text.split(' ').map((pair) => pair.split(',').map(Number))
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ramer–Douglas–Peucker: drops points that add no visible detail. */
export function simplifyPoints(points, tolerance = 0.6) {
  if (points.length <= 2) return points
  const keep = new Array(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()
    let maxDistance = 0
    let index = -1
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegment(points[i][0], points[i][1], points[start][0], points[start][1], points[end][0], points[end][1])
      if (d > maxDistance) {
        maxDistance = d
        index = i
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = true
      stack.push([start, index], [index, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Strokes of a drawing in board coordinates. */
export function drawingStrokesOnBoard(item) {
  const sx = item.w / item.vw
  const sy = item.h / item.vh
  return item.s.map((stroke) => ({
    c: stroke.c,
    sw: stroke.sw * sx,
    points: decodePoints(stroke.p).map(([x, y]) => [item.x + x * sx, item.y + y * sy]),
  }))
}

/** Builds a drawing item around strokes given in board coordinates. */
export function buildDrawing(id, strokes) {
  const usable = strokes.filter((stroke) => stroke.points.length > 0)
  if (usable.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  usable.forEach((stroke) => {
    const pad = stroke.sw / 2 + 1
    stroke.points.forEach(([x, y]) => {
      minX = Math.min(minX, x - pad)
      minY = Math.min(minY, y - pad)
      maxX = Math.max(maxX, x + pad)
      maxY = Math.max(maxY, y + pad)
    })
  })
  minY = Math.max(0, minY)
  const w = Math.max(4, maxX - minX)
  const h = Math.max(4, maxY - minY)
  return {
    id,
    t: 'draw',
    x: round1(minX),
    y: round1(minY),
    w: round1(w),
    h: round1(h),
    vw: round1(w),
    vh: round1(h),
    s: usable.map((stroke) => ({
      c: stroke.c,
      sw: round1(stroke.sw),
      p: encodePoints(stroke.points.map(([x, y]) => [x - minX, y - minY])),
    })),
    r: 0,
  }
}

/** Smooth SVG path through the points (midpoint quadratic curves). */
export function strokePath(points) {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const [x, y] = points[0]
    return `M${x} ${y}L${x + 0.01} ${y}`
  }
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    d += `Q${x} ${y} ${round1((x + nx) / 2)} ${round1((y + ny) / 2)}`
  }
  const last = points[points.length - 1]
  return `${d}L${last[0]} ${last[1]}`
}

/** True when the point (board coordinates) touches the stroke. */
export function strokeHit(item, strokeIndex, px, py, radius) {
  const stroke = drawingStrokesOnBoard({ ...item, s: [item.s[strokeIndex]] })[0]
  const reach = radius + stroke.sw / 2
  const points = stroke.points
  if (points.length === 1) return Math.hypot(px - points[0][0], py - points[0][1]) <= reach
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) <= reach) return true
  }
  return false
}

export function scrapBoardSize(board) {
  return JSON.stringify(board).length
}
