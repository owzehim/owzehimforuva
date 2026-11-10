import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowArcLeft,
  ArrowArcRight,
  ArrowsOutLineVertical,
  CaretDown,
  CaretUp,
  ImageSquare,
  Minus,
  PencilSimple,
  Plus,
  TextB,
  TextT,
  Trash,
  X,
} from '@phosphor-icons/react'
import {
  SCRAP_COLORS,
  SCRAP_FONT_MAX,
  SCRAP_FONT_MIN,
  SCRAP_IMAGE_MAX,
  SCRAP_IMAGE_MIN,
  SCRAP_LINE,
  SCRAP_MAX_HEIGHT,
  SCRAP_MAX_ITEMS,
  SCRAP_MIN_HEIGHT,
  SCRAP_TEXT_MAX,
  SCRAP_TEXT_MIN_WIDTH,
  SCRAP_WIDTH,
  normalizeScrapBoard,
  scrapContentBottom,
} from '../../domain/scrapBoard'
import { useFeedback } from '../feedback/feedbackContext.js'
import { ScrapItem } from './ScrapPaper'
import { scrapPaperBackground, scrapTextStyle } from './scrapPaperStyle'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const HISTORY_LIMIT = 60
const ADD_SPACE = SCRAP_LINE * 5

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function loadImageSize(url) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || 4, height: image.naturalHeight || 3 })
    image.onerror = () => resolve({ width: 4, height: 3 })
    image.src = url
  })
}

function ToolButton({ icon: Icon, label, onClick, disabled, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex min-w-[48px] flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[11px] transition-colors disabled:opacity-35 ' +
        (active ? 'bg-orange-50 text-orange-600' : 'text-gray-600 active:bg-gray-100')
      }
    >
      <Icon size={20} weight={active ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  )
}

function BarButton({ children, onClick, disabled, tone = 'default', label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={
        'flex h-9 flex-shrink-0 items-center justify-center gap-1 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-35 ' +
        (tone === 'danger'
          ? 'bg-red-50 text-red-600 active:bg-red-100'
          : tone === 'active'
            ? 'bg-gray-900 text-white'
            : 'bg-gray-100 text-gray-700 active:bg-gray-200')
      }
    >
      {children}
    </button>
  )
}

/**
 * Full-screen 낙서장 editor for admins. New photos stay local (blob URLs)
 * until the place is saved, so cancelling never leaves files behind.
 */
export default function ScrapBoardEditor({ placeName, initialBoard, imagePrefix, onCancel, onDone }) {
  const { toast, confirm } = useFeedback()
  const [history, setHistory] = useState(() => ({
    past: [],
    present: normalizeScrapBoard(initialBoard, { prefix: imagePrefix, allowBlob: true }),
    future: [],
  }))
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(SCRAP_WIDTH)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const filesRef = useRef(new Map())
  const dragRef = useRef(null)
  const pinchRef = useRef(null)
  const zoomRef = useRef(1)
  const pendingScrollRef = useRef(null)
  const editSnapshotRef = useRef(null)
  const dirtyRef = useRef(false)

  const board = history.present
  const base = fitWidth / SCRAP_WIDTH
  const scale = base * zoom
  const selected = board.items.find((item) => item.id === selectedId) || null

  useLayoutEffect(() => {
    const element = canvasRef.current
    if (!element) return undefined
    const measure = () => setFitWidth(Math.min(460, Math.max(240, element.clientWidth - 24)))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = canvasRef.current
    const pending = pendingScrollRef.current
    if (!element || !pending) return
    pendingScrollRef.current = null
    element.scrollLeft = Math.max(0, pending.left)
    element.scrollTop = Math.max(0, pending.top)
  }, [zoom])

  // Live changes (dragging, typing) replace the present board; commit()
  // records the board as it was before the gesture so undo restores it.
  const replace = useCallback((updater) => {
    setHistory((h) => ({ ...h, present: updater(h.present) }))
  }, [])

  const commit = useCallback((before) => {
    dirtyRef.current = true
    setHistory((h) => {
      if (before === h.present) return h
      return { past: [...h.past, before].slice(-HISTORY_LIMIT), present: h.present, future: [] }
    })
  }, [])

  const apply = useCallback((updater) => {
    dirtyRef.current = true
    setHistory((h) => {
      const next = updater(h.present)
      if (next === h.present) return h
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
    })
  }, [])

  const updateItem = (id, patch) => (b) => ({
    ...b,
    items: b.items.map((item) => (item.id === id ? { ...item, ...patch(item) } : item)),
  })

  const undo = () => {
    setEditingId(null)
    setHistory((h) => (h.past.length
      ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
      : h))
  }
  const redo = () => {
    setEditingId(null)
    setHistory((h) => (h.future.length
      ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
      : h))
  }

  const boardRef = useRef(board)
  useLayoutEffect(() => {
    boardRef.current = board
  })

  // New items go just below everything already on the page; the page grows to fit.
  const placeY = (height) => {
    const below = Math.ceil((scrapContentBottom(boardRef.current) + 8) / SCRAP_LINE) * SCRAP_LINE
    return clamp(below || SCRAP_LINE, 0, SCRAP_MAX_HEIGHT - height - SCRAP_LINE)
  }

  const growFor = (b, item, height) => ({
    ...b,
    h: Math.max(b.h, Math.min(SCRAP_MAX_HEIGHT, Math.ceil((item.y + height + SCRAP_LINE) / SCRAP_LINE) * SCRAP_LINE)),
    items: [...b.items, item],
  })

  const revealY = (y) => {
    window.setTimeout(() => {
      const element = canvasRef.current
      if (!element) return
      const top = y * scale
      if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - 120) {
        element.scrollTo({ top: Math.max(0, top - 80), behavior: 'smooth' })
      }
    }, 50)
  }

  const roomForItem = () => {
    if (board.items.length >= SCRAP_MAX_ITEMS) {
      toast.warning('더 넣을 수 없어요', { message: `낙서장에는 사진과 글을 합쳐 ${SCRAP_MAX_ITEMS}개까지 넣을 수 있어요.` })
      return false
    }
    return true
  }

  const addText = () => {
    if (!roomForItem()) return
    const item = { id: newId(), t: 'text', text: '', x: 48, y: placeY(SCRAP_LINE), w: 260, fs: 15, c: SCRAP_COLORS[0], b: false, r: 0 }
    editSnapshotRef.current = null
    apply((b) => growFor(b, item, SCRAP_LINE))
    revealY(item.y)
    setSelectedId(item.id)
    setEditingId(item.id)
  }

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || [])
    for (const file of files) {
      if (!roomForItem()) break
      if (!IMAGE_TYPES.includes(file.type)) {
        toast.error('이 파일은 넣을 수 없어요', { message: 'JPG·PNG·WebP·AVIF 사진만 넣을 수 있어요.' })
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error('사진이 너무 커요', { message: '15MB 이하 사진만 넣을 수 있어요.' })
        continue
      }
      const url = URL.createObjectURL(file)
      filesRef.current.set(url, file)
      const { width, height } = await loadImageSize(url)
      const w = 180
      const h = clamp(Math.round((w * height) / width), 40, 320)
      const item = { id: newId(), t: 'img', src: url, x: Math.round((SCRAP_WIDTH - w) / 2), y: placeY(h), w, h, r: 0 }
      apply((b) => growFor(b, item, h))
      boardRef.current = growFor(boardRef.current, item, h)
      revealY(item.y)
      setSelectedId(item.id)
    }
  }

  const removeSelected = () => {
    if (!selected) return
    apply((b) => ({ ...b, items: b.items.filter((item) => item.id !== selected.id) }))
    setSelectedId(null)
    setEditingId(null)
  }

  const moveLayer = (direction) => {
    if (!selected) return
    apply((b) => {
      const index = b.items.findIndex((item) => item.id === selected.id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= b.items.length) return b
      const items = [...b.items]
      ;[items[index], items[target]] = [items[target], items[index]]
      return { ...b, items }
    })
  }

  const finishEditing = () => {
    const id = editingId
    if (!id) return
    setEditingId(null)
    const item = board.items.find((entry) => entry.id === id)
    if (item && !item.text.trim()) {
      replace((b) => ({ ...b, items: b.items.filter((entry) => entry.id !== id) }))
      setSelectedId(null)
      return
    }
    if (editSnapshotRef.current) commit(editSnapshotRef.current)
    editSnapshotRef.current = null
  }

  const startEditing = (id) => {
    editSnapshotRef.current = board
    setEditingId(id)
  }

  // ── Pointer gestures on items ────────────────────────────────
  const onItemPointerDown = (event, item, mode = 'move') => {
    if (editingId === item.id && mode === 'move') return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (pinchRef.current) return
    event.stopPropagation()
    if (editingId && editingId !== item.id) finishEditing()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      id: item.id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      item,
      before: board,
      wasSelected: selectedId === item.id,
      moved: false,
    }
    setSelectedId(item.id)
  }

  const onItemPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = (event.clientX - drag.startX) / scale
    const dy = (event.clientY - drag.startY) / scale
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    const start = drag.item
    if (drag.mode === 'move') {
      replace(updateItem(drag.id, (item) => ({
        x: clamp(start.x + dx, -(item.w - 16), SCRAP_WIDTH - 16),
        y: clamp(start.y + dy, 0, board.h - 16),
      })))
    } else if (start.t === 'img') {
      const ratio = start.h / start.w
      const w = clamp(start.w + dx, SCRAP_IMAGE_MIN, Math.min(SCRAP_IMAGE_MAX, SCRAP_IMAGE_MAX / ratio))
      replace(updateItem(drag.id, () => ({ w, h: Math.max(SCRAP_IMAGE_MIN, w * ratio) })))
    } else {
      replace(updateItem(drag.id, () => ({ w: clamp(start.w + dx, SCRAP_TEXT_MIN_WIDTH, SCRAP_WIDTH) })))
    }
  }

  const onItemPointerUp = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.moved) {
      if (drag.mode === 'move' && drag.item.t === 'text' && drag.item.fs <= 20) {
        // Keep text sitting on the ruled lines.
        replace(updateItem(drag.id, (item) => ({ y: clamp(Math.round(item.y / SCRAP_LINE) * SCRAP_LINE, 0, board.h - SCRAP_LINE) })))
      }
      commit(drag.before)
    } else if (drag.wasSelected && drag.item.t === 'text' && drag.mode === 'move') {
      startEditing(drag.id)
    }
  }

  // ── Pinch / ctrl+wheel zoom on the canvas ────────────────────
  const setZoomAround = useCallback((next, anchor) => {
    const element = canvasRef.current
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM)
    if (element && anchor) {
      const ratio = value / zoomRef.current
      pendingScrollRef.current = {
        left: (element.scrollLeft + anchor.x) * ratio - anchor.x,
        top: (element.scrollTop + anchor.y) * ratio - anchor.y,
      }
    }
    zoomRef.current = value
    setZoom(value)
  }, [])

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return undefined
    const dist = (t) => Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY) || 1
    const mid = (t) => {
      const rect = element.getBoundingClientRect()
      return { x: (t[0].clientX + t[1].clientX) / 2 - rect.left, y: (t[0].clientY + t[1].clientY) / 2 - rect.top }
    }
    const onTouchStart = (event) => {
      if (event.touches.length !== 2) return
      if (dragRef.current) {
        replace(() => dragRef.current.before)
        dragRef.current = null
      }
      pinchRef.current = { distance: dist(event.touches), zoom: zoomRef.current }
    }
    const onTouchMove = (event) => {
      if (!pinchRef.current || event.touches.length !== 2) return
      event.preventDefault()
      const next = pinchRef.current.zoom * (dist(event.touches) / pinchRef.current.distance)
      setZoomAround(next, mid(event.touches))
    }
    const onTouchEnd = (event) => {
      if (event.touches.length < 2) pinchRef.current = null
    }
    const onWheel = (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      setZoomAround(zoomRef.current * Math.exp(-event.deltaY / 300), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchEnd, { passive: true })
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
      element.removeEventListener('wheel', onWheel)
    }
  }, [replace, setZoomAround])

  const zoomBy = (factor) => {
    const element = canvasRef.current
    setZoomAround(zoomRef.current * factor, element ? { x: element.clientWidth / 2, y: element.clientHeight / 2 } : null)
  }

  // ── Close / finish ───────────────────────────────────────────
  const releaseUnusedFiles = (keep) => {
    filesRef.current.forEach((_, url) => {
      if (!keep.has(url)) {
        URL.revokeObjectURL(url)
        filesRef.current.delete(url)
      }
    })
  }

  const handleCancel = async () => {
    if (dirtyRef.current) {
      const ok = await confirm({
        icon: 'warning',
        title: '바꾼 내용을 버릴까요?',
        message: '완료를 누르지 않으면 이번에 바꾼 낙서장 내용이 사라져요.',
        confirmLabel: '버리기',
        cancelLabel: '계속 편집',
        tone: 'danger',
      })
      if (!ok) return
    }
    const kept = new Set((initialBoard?.items || []).map((item) => item.src).filter(Boolean))
    releaseUnusedFiles(kept)
    onCancel()
  }

  const handleDone = () => {
    const finalBoard = normalizeScrapBoard(
      { ...board, items: board.items.filter((item) => item.t !== 'text' || item.text.trim()) },
      { prefix: imagePrefix, allowBlob: true },
    )
    const used = new Set(finalBoard.items.map((item) => item.src).filter(Boolean))
    releaseUnusedFiles(used)
    const files = {}
    filesRef.current.forEach((file, url) => {
      if (used.has(url)) files[url] = file
    })
    onDone(finalBoard, files)
  }

  const handleCancelRef = useRef(handleCancel)
  useLayoutEffect(() => {
    handleCancelRef.current = handleCancel
  })
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        void handleCancelRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const contentBottom = scrapContentBottom(board)
  const canShrink = board.h > Math.max(SCRAP_MIN_HEIGHT, Math.ceil((contentBottom + SCRAP_LINE) / SCRAP_LINE) * SCRAP_LINE)
  const handleSize = 22 / scale

  return createPortal(
    <div
      className="fixed inset-0 z-[1600] flex flex-col bg-gray-50"
      role="dialog"
      aria-modal="true"
      aria-label="낙서장 편집"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex flex-shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <button type="button" onClick={handleCancel} className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600" aria-label="닫기">
          <X size={18} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-gray-900">낙서장 편집</p>
          <p className="truncate text-xs text-gray-500">{placeName || '새 장소'}</p>
        </div>
        <button type="button" onClick={handleDone} className="h-9 rounded-full bg-orange-500 px-4 text-sm font-semibold text-white active:bg-orange-600">
          완료
        </button>
      </div>

      <div className="mx-3 flex flex-shrink-0 items-center justify-between rounded-2xl bg-white px-1 py-0.5 shadow-sm">
        <div className="flex">
          <ToolButton icon={ImageSquare} label="사진" onClick={() => fileInputRef.current?.click()} />
          <ToolButton icon={TextT} label="텍스트" onClick={addText} />
          <ToolButton icon={ArrowArcLeft} label="취소" onClick={undo} disabled={!history.past.length} />
          <ToolButton icon={ArrowArcRight} label="다시" onClick={redo} disabled={!history.future.length} />
        </div>
        <div className="flex items-center gap-0.5 pr-1">
          <button type="button" onClick={() => zoomBy(1 / 1.25)} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 active:bg-gray-100" aria-label="축소"><Minus size={16} weight="bold" /></button>
          <button type="button" onClick={() => setZoomAround(1, null)} className="w-11 text-center text-xs tabular-nums text-gray-500" aria-label="100%로">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => zoomBy(1.25)} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 active:bg-gray-100" aria-label="확대"><Plus size={16} weight="bold" /></button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(event) => {
            void addPhotos(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      <div
        ref={canvasRef}
        className="relative mt-2 min-h-0 flex-1 overflow-auto overscroll-contain"
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget || event.target.dataset?.scrapBackground) {
            if (editingId) finishEditing()
            setSelectedId(null)
          }
        }}
      >
        <div className="mx-auto px-3 pb-6 pt-1" style={{ width: SCRAP_WIDTH * scale + 24 }}>
          <div
            className="relative overflow-hidden rounded-xl shadow-[0_0_0_1px_#e5e7eb]"
            style={{ width: SCRAP_WIDTH * scale, height: board.h * scale }}
          >
            <div
              data-scrap-background="true"
              className="absolute left-0 top-0"
              style={{ width: SCRAP_WIDTH, height: board.h, transform: `scale(${scale})`, transformOrigin: '0 0', ...scrapPaperBackground() }}
            >
              {board.items.map((item) => {
                const isSelected = item.id === selectedId
                const isEditing = item.id === editingId
                return (
                  <ScrapItem
                    key={item.id}
                    item={item}
                    onPointerDown={(event) => onItemPointerDown(event, item)}
                    onPointerMove={onItemPointerMove}
                    onPointerUp={onItemPointerUp}
                    onPointerCancel={onItemPointerUp}
                    style={{
                      touchAction: 'none',
                      cursor: isEditing ? 'text' : 'move',
                      outline: isSelected ? `${2 / scale}px solid #3b82f6` : item.t === 'text' && !item.text ? `${1 / scale}px dashed #93c5fd` : 'none',
                      outlineOffset: 3 / scale,
                      minHeight: item.t === 'text' ? SCRAP_LINE : undefined,
                      userSelect: 'none',
                    }}
                  >
                    {item.t === 'text' && isEditing ? (
                      <textarea
                        autoFocus
                        value={item.text}
                        maxLength={SCRAP_TEXT_MAX}
                        placeholder="여기에 쓰세요"
                        onChange={(event) => replace(updateItem(item.id, () => ({ text: event.target.value })))}
                        onBlur={finishEditing}
                        onPointerDown={(event) => event.stopPropagation()}
                        rows={Math.max(1, item.text.split('\n').length)}
                        className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-gray-400"
                        style={{ ...scrapTextStyle(item), fontFamily: 'inherit', fieldSizing: 'content' }}
                      />
                    ) : item.t === 'text' ? (item.text || ' ') : null}
                    {isSelected && !isEditing && (
                      <span
                        role="presentation"
                        onPointerDown={(event) => onItemPointerDown(event, item, 'resize')}
                        onPointerMove={onItemPointerMove}
                        onPointerUp={onItemPointerUp}
                        onPointerCancel={onItemPointerUp}
                        className="absolute rounded-full border-blue-500 bg-white"
                        style={{
                          width: handleSize,
                          height: handleSize,
                          right: -handleSize / 2,
                          bottom: -handleSize / 2,
                          borderWidth: 2 / scale,
                          touchAction: 'none',
                          cursor: 'nwse-resize',
                          boxShadow: `0 ${1 / scale}px ${4 / scale}px rgba(0,0,0,.2)`,
                        }}
                      />
                    )}
                  </ScrapItem>
                )
              })}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-gray-400">페이지 끝 · 위아래로 스크롤해서 보여요</p>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2">
        {selected ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {selected.t === 'text' && (
              <>
                <BarButton onClick={() => startEditing(selected.id)} label="글 수정"><PencilSimple size={14} />수정</BarButton>
                <BarButton label="글자 작게" disabled={selected.fs <= SCRAP_FONT_MIN} onClick={() => apply(updateItem(selected.id, (item) => ({ fs: clamp(item.fs - 1, SCRAP_FONT_MIN, SCRAP_FONT_MAX) })))}>가−</BarButton>
                <span className="w-6 flex-shrink-0 text-center text-xs tabular-nums text-gray-500">{selected.fs}</span>
                <BarButton label="글자 크게" disabled={selected.fs >= SCRAP_FONT_MAX} onClick={() => apply(updateItem(selected.id, (item) => ({ fs: clamp(item.fs + 1, SCRAP_FONT_MIN, SCRAP_FONT_MAX) })))}>가+</BarButton>
                <BarButton label="굵게" tone={selected.b ? 'active' : 'default'} onClick={() => apply(updateItem(selected.id, (item) => ({ b: !item.b })))}><TextB size={14} weight="bold" /></BarButton>
                {SCRAP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`글자 색 ${color}`}
                    onClick={() => apply(updateItem(selected.id, () => ({ c: color })))}
                    className="h-7 w-7 flex-shrink-0 rounded-full"
                    style={{ background: color, boxShadow: selected.c === color ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : 'none' }}
                  />
                ))}
              </>
            )}
            <BarButton label="앞으로" onClick={() => moveLayer(1)} disabled={board.items[board.items.length - 1]?.id === selected.id}><CaretUp size={14} />앞으로</BarButton>
            <BarButton label="뒤로" onClick={() => moveLayer(-1)} disabled={board.items[0]?.id === selected.id}><CaretDown size={14} />뒤로</BarButton>
            <BarButton label="삭제" tone="danger" onClick={removeSelected}><Trash size={14} />삭제</BarButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <BarButton
              label="아래 공간 추가"
              disabled={board.h >= SCRAP_MAX_HEIGHT}
              onClick={() => apply((b) => ({ ...b, h: Math.min(SCRAP_MAX_HEIGHT, b.h + ADD_SPACE) }))}
            >
              <ArrowsOutLineVertical size={14} />아래 공간 추가
            </BarButton>
            <BarButton
              label="빈 공간 줄이기"
              disabled={!canShrink}
              onClick={() => apply((b) => ({
                ...b,
                h: Math.max(SCRAP_MIN_HEIGHT, Math.ceil((scrapContentBottom(b) + SCRAP_LINE) / SCRAP_LINE) * SCRAP_LINE),
              }))}
            >
              빈 공간 줄이기
            </BarButton>
            <span className="ml-auto text-[11px] text-gray-400">{board.items.length}/{SCRAP_MAX_ITEMS}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
