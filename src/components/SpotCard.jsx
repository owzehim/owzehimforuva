import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, MapPin, Ticket, Star, StarFour, X } from '@phosphor-icons/react'
import { BowlSteam, HandHeart, Wine, CoinVertical } from '@phosphor-icons/react'
import { useStoreReviewSummary } from '../hooks/useStoreReviewSummary'
import { computeStarDisplay, formatAverageRating } from '../domain/reviewDomain'
import { REVIEW_TAGS } from '../domain/reviewTypes'
import { GoodToKnowNotesPanel } from './GoodToKnowNotesPanel'
import { sanitizeRichText } from '../lib/sanitizeHtml'
import { useModalFocus } from '../hooks/useModalFocus'

export function RichText({ text, className = '' }) {
  if (!text) return null
  return <span className={className} dangerouslySetInnerHTML={{ __html: sanitizeRichText(text) }} />
}

const TAG_ICON_COMPONENTS = {
  BowlSteam,
  HandHeart,
  Wine,
  CoinVertical,
}

const DARK_MUTED_ACCENT = '#374151'

function isDarkMode() {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )
}

// ?? Read-only star row ??????????????????????????????????????????

function StarDisplay({
  averageRating,
  showWhenZero = false,
  showAverage = true,
  darkMode = false,
}) {
  if (averageRating == null || Number.isNaN(averageRating)) return null

  const formatted = showWhenZero
    ? averageRating.toFixed(1)
    : formatAverageRating(averageRating)
  if (!formatted) return null

  const { filled, half, empty } = computeStarDisplay(averageRating)

  // Only change grey in dark mode; keep original grey in light mode
  const emptyColor = darkMode ? DARK_MUTED_ACCENT : '#d1d5db'

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {/* full orange stars */}
        {Array.from({ length: filled }).map((_, i) => (
          <Star key={'f' + i} size={12} weight="fill" color="#f97316" />
        ))}

        {/* half star: 50% orange, 50% grey */}
        {half && (
          <span key="half" className="relative inline-flex">
            {/* grey full star underneath */}
            <Star size={12} weight="fill" color={emptyColor} />
            {/* left half orange on top */}
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: '50%' }}
            >
              <Star size={12} weight="fill" color="#f97316" />
            </span>
          </span>
        )}

        {/* empty grey stars */}
        {Array.from({ length: empty }).map((_, i) => (
          <Star key={'e' + i} size={12} weight="fill" color={emptyColor} />
        ))}
      </div>
      {showAverage && (
        <span className="text-xs text-amber-500 font-medium">{formatted}</span>
      )}
    </div>
  )
}

// ?? Tag bar chart ???????????????????????????????????????????????

function TagBarChart({ tagCounts = {}, reviewCount = 0 }) {
  const displayTags = REVIEW_TAGS
    .map((tag) => ({
      ...tag,
      count: reviewCount > 0 ? Math.max(0, Number(tagCounts?.[tag.key]) || 0) : 0,
    }))
    .sort((a, b) => b.count - a.count)
  const maxCount = displayTags[0]?.count ?? 0
  const hasMemberReviews = reviewCount > 0 && maxCount > 0

  return (
    <div className="spot-card-tag-chart pb-0">
      <div className="spot-card-tag-chart-content pt-3">
        <div className="spot-card-tag-chart-heading mb-3">
          <p className="text-xs font-semibold text-gray-500">
            멤버 평가
          </p>
        </div>

        <div className="spot-card-tag-chart-rows flex flex-col gap-2.5 pl-4">
          {displayTags.map((tag) => {
            const IconComponent = TAG_ICON_COMPONENTS[tag.icon]
            const pct =
              maxCount > 0 ? Math.round((tag.count / maxCount) * 100) : 0

            return (
              <div key={tag.key} className="spot-card-tag-chart-row flex items-center gap-2">
                <div className="spot-card-tag-chart-label flex items-center gap-1 w-28 flex-shrink-0">
                  {IconComponent && (
                    <IconComponent size={13} weight="fill" color="#f97316" />
                  )}
                  {!IconComponent && (
                    <span className="text-xs text-red-500">
                      ❌ No icon for: {tag.icon}
                    </span>
                  )}
                  <span className="text-xs text-gray-600 truncate">
                    {tag.label}
                  </span>
                </div>

                {hasMemberReviews ? (
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-400 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                ) : (
                  <div className="flex-1 h-2 bg-gray-200 rounded-full" />
                )}

                <span className="text-xs text-gray-400 font-medium w-4 text-right flex-shrink-0">
                  {tag.count}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ?? Lightbox ????????????????????????????????????????????????????

const EMPTY_IMAGE_URLS = Object.freeze([])

function Lightbox({ imgs, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex)
  const [visible, setVisible] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 })
  const [zoomGestureActive, setZoomGestureActive] = useState(false)
  const [zoomBounds, setZoomBounds] = useState(null)
  const [imageRatios, setImageRatios] = useState({})
  const [lightboxBounds, setLightboxBounds] = useState(() => ({
    width: window.innerWidth * 0.9,
    height: window.innerHeight * 0.9,
  }))
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const dialogRef = useRef(null)
  const activePhotoRef = useRef(null)
  const pinchStartDistance = useRef(null)
  const pinchStartCenter = useRef(null)
  const zoomGestureMode = useRef(null)
  const zoomBoundsRef = useRef(null)
  const zoomOffsetRef = useRef({ x: 0, y: 0 })
  const panStart = useRef(null)
  const zoomResetTimer = useRef(null)
  const activeImageRatio = imageRatios[index] || 1
  const imageMaxHeight = lightboxBounds.height - (imgs.length > 1 ? 38 : 0)
  const imageWidth = Math.min(lightboxBounds.width, imageMaxHeight * activeImageRatio)
  const imageHeight = imageWidth / activeImageRatio

  const resetZoom = useCallback(() => {
    if (zoomResetTimer.current) {
      window.clearTimeout(zoomResetTimer.current)
      zoomResetTimer.current = null
    }
    pinchStartDistance.current = null
    pinchStartCenter.current = null
    zoomGestureMode.current = null
    zoomBoundsRef.current = null
    zoomOffsetRef.current = { x: 0, y: 0 }
    panStart.current = null
    setZoomScale(1)
    setZoomOffset({ x: 0, y: 0 })
    setZoomGestureActive(false)
    setZoomBounds(null)
  }, [])

  const animateZoomReset = () => {
    pinchStartDistance.current = null
    pinchStartCenter.current = null
    zoomGestureMode.current = null
    panStart.current = null
    zoomOffsetRef.current = { x: 0, y: 0 }
    setZoomScale(1)
    setZoomOffset({ x: 0, y: 0 })
    setZoomGestureActive(false)
    if (zoomResetTimer.current) window.clearTimeout(zoomResetTimer.current)
    zoomResetTimer.current = window.setTimeout(() => {
      zoomBoundsRef.current = null
      setZoomBounds(null)
      zoomResetTimer.current = null
    }, 240)
  }

  const goToIndex = useCallback((nextIndex) => {
    const clampedIndex = Math.max(0, Math.min(nextIndex, imgs.length - 1))
    if (clampedIndex === index) return
    resetZoom()
    setIndex(clampedIndex)
  }, [imgs.length, index, resetZoom])

  // zoom-in + fade-in on open
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  useEffect(() => {
    const updateBounds = () => setLightboxBounds({
      width: window.innerWidth * 0.9,
      height: window.innerHeight * 0.9,
    })
    window.addEventListener('resize', updateBounds)
    return () => window.removeEventListener('resize', updateBounds)
  }, [])

  useEffect(() => {
    ;[index, index - 1, index + 1]
      .filter((nextIndex) => nextIndex >= 0 && nextIndex < imgs.length)
      .forEach((nextIndex) => {
        const image = new Image()
        image.decoding = 'async'
        image.src = imgs[nextIndex]
        image.decode?.().catch(() => {})
      })
  }, [imgs, index])

  useEffect(() => () => {
    if (zoomResetTimer.current) window.clearTimeout(zoomResetTimer.current)
  }, [])

  const handleClose = useCallback(() => {
    resetZoom()
    setVisible(false)
    setTimeout(() => onClose(), 250)
  }, [onClose, resetZoom])
  const handleDialogKeyDown = useModalFocus(dialogRef, handleClose)

  const handleTouchStart = (e) => {
    if (
      e.touches.length === 2 &&
      e.target instanceof Element &&
      e.target.closest('[data-lightbox-active-photo="true"]')
    ) {
      if (zoomResetTimer.current) {
        window.clearTimeout(zoomResetTimer.current)
        zoomResetTimer.current = null
      }
      const [first, second] = e.touches
      pinchStartDistance.current = Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      )
      pinchStartCenter.current = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      }
      zoomGestureMode.current = 'pinch'
      zoomOffsetRef.current = { x: 0, y: 0 }
      setZoomOffset({ x: 0, y: 0 })
      setZoomScale(1)
      setZoomGestureActive(true)
      const rect = activePhotoRef.current?.getBoundingClientRect()
      if (rect) {
        const bounds = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
        zoomBoundsRef.current = bounds
        setZoomBounds(bounds)
      }
      touchStartX.current = null
      touchStartY.current = null
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (zoomGestureMode.current) {
      e.stopPropagation()
      return
    }
    if (e.touches.length !== 1) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e) => {
    if (zoomGestureMode.current === 'pinch' && e.touches.length === 2 && pinchStartDistance.current) {
      e.preventDefault()
      e.stopPropagation()
      const [first, second] = e.touches
      const distance = Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      )
      const center = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      }
      const scale = Math.min(3, Math.max(1, distance / pinchStartDistance.current))
      const bounds = zoomBoundsRef.current
      const startCenter = pinchStartCenter.current
      setZoomScale(scale)
      if (bounds && startCenter) {
        const imageCenterX = bounds.left + bounds.width / 2
        const imageCenterY = bounds.top + bounds.height / 2
        const offset = {
          x: center.x - (imageCenterX + scale * (startCenter.x - imageCenterX)),
          y: center.y - (imageCenterY + scale * (startCenter.y - imageCenterY)),
        }
        zoomOffsetRef.current = offset
        setZoomOffset(offset)
      }
      return
    }

    if (zoomGestureMode.current === 'pan' && e.touches.length === 1) {
      e.preventDefault()
      e.stopPropagation()
      const touch = e.touches[0]
      const start = panStart.current
      if (start) {
        const offset = {
          x: start.offset.x + touch.clientX - start.x,
          y: start.offset.y + touch.clientY - start.y,
        }
        zoomOffsetRef.current = offset
        setZoomOffset(offset)
      }
    }
  }

  const handleTouchEnd = (e) => {
    if (zoomGestureMode.current) {
      if (e.touches.length === 1 && zoomGestureMode.current === 'pinch') {
        const touch = e.touches[0]
        zoomGestureMode.current = 'pan'
        panStart.current = {
          x: touch.clientX,
          y: touch.clientY,
          offset: zoomOffsetRef.current,
        }
      } else if (e.touches.length === 0) {
        animateZoomReset()
      }
      touchStartX.current = null
      touchStartY.current = null
      e.stopPropagation()
      return
    }
    if (e.touches.length > 0) return
    if (touchStartX.current == null || touchStartY.current == null) return

    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current

    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    // Vertical swipe (up or down) → close
    if (absDy > absDx && absDy > 60) {
      handleClose()
    }
    // Horizontal swipe → next / prev
    else if (absDx > absDy && absDx > 40) {
      if (dx < 0) {
        // swipe left → next
        goToIndex(index + 1)
      } else {
        // swipe right → prev
        if (index === 0) handleClose()
        else goToIndex(index - 1)
      }
    }

    touchStartX.current = null
    touchStartY.current = null
  }

  return (
    <>
      <style>{`
        @keyframes lightboxZoomIn {
          from { transform: translateY(-18px) scale(0.9); }
          to { transform: translateY(-18px) scale(1); }
        }
        .lightbox-zoom-enter {
          animation: lightboxZoomIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards;
        }
      `}</style>
      {zoomBounds && typeof document !== 'undefined' && createPortal(
        <img
          src={imgs[index]}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'fixed',
            left: zoomBounds.left,
            top: zoomBounds.top,
            width: zoomBounds.width,
            height: zoomBounds.height,
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            transform: `translate3d(${zoomOffset.x}px, ${zoomOffset.y}px, 0) scale(${zoomScale})`,
            transformOrigin: 'center center',
            transition: zoomGestureActive ? 'none' : 'transform 240ms cubic-bezier(0.2,0.8,0.2,1)',
            willChange: 'transform',
            zIndex: 2001,
            pointerEvents: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        />,
        document.body,
      )}

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="매장 사진 보기"
        tabIndex={-1}
        onKeyDown={(event) => {
          handleDialogKeyDown(event)
          if (event.defaultPrevented) return
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            goToIndex(index + 1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            if (index === 0) handleClose()
            else goToIndex(index - 1)
          }
        }}
        onClick={handleClose}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease',
          touchAction: 'none',
        }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleClose()
          }}
          aria-label="매장 사진 보기 닫기"
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{ zIndex: 2002 }}
        >
          <X size={22} weight="bold" aria-hidden="true" />
        </button>
        <div
          onClick={(e) => e.stopPropagation()}
          className={visible ? 'lightbox-zoom-enter' : ''}
          style={{
            width: '100%',
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <div style={{ width: `${imageWidth}px`, height: `${imageHeight}px`, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              transform: `translateX(-${index * 100}%)`,
              transition: 'transform 0.3s ease',
            }}
          >
            {imgs.map((src, imgIndex) => (
              <div
                key={`${src}-${imgIndex}`}
                style={{
                  width: '100%',
                  height: '100%',
                  flexShrink: 0,
                  padding: '0 6px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  ref={imgIndex === index ? activePhotoRef : null}
                  src={src}
                  alt={'Photo ' + (imgIndex + 1)}
                  data-lightbox-active-photo={imgIndex === index ? 'true' : undefined}
                  decoding="async"
                  fetchPriority={imgIndex === index ? 'high' : 'auto'}
                  loading={Math.abs(imgIndex - index) <= 1 ? 'eager' : 'lazy'}
                  onLoad={(event) => {
                    const ratio = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight
                    if (Number.isFinite(ratio) && ratio > 0) {
                      setImageRatios((previous) => previous[imgIndex] === ratio ? previous : { ...previous, [imgIndex]: ratio })
                    }
                  }}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    borderRadius: 12,
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                    opacity: zoomBounds && imgIndex === index && zoomGestureActive ? 0 : 1,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                  draggable={false}
                />
              </div>
            ))}
          </div>
          </div>

        {imgs.length > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 6,
              paddingTop: 4,
            }}
          >
            {imgs.map((_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`사진 ${i + 1} 보기`}
                aria-current={i === index ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  goToIndex(i)
                }}
                className="flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
                style={{
                  width: 8,
                  height: 8,
                  border: 0,
                  padding: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: i === index ? 8 : 6,
                    height: i === index ? 8 : 6,
                    borderRadius: '999px',
                    background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                    transition: 'all 0.2s',
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  )
}

// ?? Thumbnail grid (same on mobile + desktop) ???????????????????

function ImageThumbnails({ imgs, onTap, darkMode }) {
  return (
    <>
      <style>{`
        @keyframes spotImageLoadingShimmer {
          0%, 100% { opacity: 0.12; }
          50% { opacity: 0.88; }
        }
      `}</style>
      <div className="relative">
        <div
          className="flex gap-1 overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {imgs.map((url, i) => (
            <SpotImageThumbnail
              key={`${url}-${i}`}
              url={url}
              index={i}
              onTap={() => onTap(i)}
              darkMode={darkMode}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function SpotImageThumbnail({ url, index, onTap, darkMode }) {
  const [loaded, setLoaded] = useState(false)
  const revealImage = () => setLoaded(true)

  return (
    <div
      onClick={onTap}
      className="spot-card-short-photo-thumbnail relative flex-shrink-0 overflow-hidden rounded-xl"
      style={{
        width: '100px',
        height: '125px',
        cursor: 'zoom-in',
        background: darkMode ? '#27272a' : '#e5e7eb',
      }}
    >
      {!loaded && (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ background: darkMode ? '#27272a' : '#e5e7eb' }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.62)',
              animation: 'spotImageLoadingShimmer 2.4s ease-in-out infinite',
            }}
          />
        </div>
      )}
      <img
        src={url}
        alt={'사진 ' + (index + 1)}
        loading="eager"
        decoding="async"
        fetchPriority={index === 0 ? 'high' : 'low'}
        onLoad={revealImage}
        onError={() => setLoaded(true)}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100px',
          height: '125px',
          objectFit: 'cover',
          display: 'block',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.28s ease',
        }}
        draggable={false}
      />
    </div>
  )
}

export function SpotCard({
  selected,
  onClose,
  onClosingStart,
  currentUserId,
  currentUserEmail,
  currentUsername,
  canComment,
  isAdmin,
  reviewAudience = 'public',
}) {
  const [cardHeightValue, setCardHeightValue] = useState(0)
  const [cardIsExpanded, setCardIsExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [isVisible, setIsVisible] = useState(false)
  const [darkMode, setDarkMode] = useState(() => isDarkMode())
  const [sheetMaxHeight, setSheetMaxHeight] = useState(0)
  const [keepLandscapeExpandedLayout, setKeepLandscapeExpandedLayout] = useState(false)
  const [googleMapsButtonCenterY, setGoogleMapsButtonCenterY] = useState(null)
  const selectedId = selected?.id
  const [reviewBoxPanelState, setReviewBoxPanelState] = useState(() => ({ selectedId, value: 'guide' }))
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const lastYRef = useRef(0)
  const cardRef = useRef(null)
  const googleMapsButtonRef = useRef(null)
  const previousSpotRef = useRef(null)
  const reviewBoxTouchStartRef = useRef(null)
  const contentScrollTouchRef = useRef(null)

  const imgs = selected?.image_urls || EMPTY_IMAGE_URLS
  const reviewBoxPanel = reviewBoxPanelState.selectedId === selectedId
    ? reviewBoxPanelState.value
    : 'guide'
  const setReviewBoxPanel = (value) => setReviewBoxPanelState({ selectedId, value })
  const imagesKey = imgs.join('|')
  const hasImages = imgs.length > 0

  const { summary } = useStoreReviewSummary(
    selected?.partnership_id,
    reviewAudience,
  )

  const WIN_H = typeof window !== 'undefined' ? window.innerHeight : 700

  const isTallSpotCard = selected?.spot_card_height === 'tall'
  const isLandscapeFullSpotCard =
    selected?.spot_card_height === 'full' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(orientation: landscape) and (max-height: 600px)').matches
  const spotCardHeightMode =
    selected?.spot_card_height === 'full' || selected?.spot_card_height === 'tall'
      ? 'full'
      : 'compact'
  const COMPACT_HEIGHT = Math.min(WIN_H * 0.22, 150)
  const FULL_HEIGHT = Math.min(WIN_H * 0.44, 315)
  const MAX_HEIGHT = Math.max(320, sheetMaxHeight || WIN_H)
  const LANDSCAPE_FULL_COLLAPSED_HEIGHT = Math.min(
    Math.max(WIN_H * 0.68, 240),
    MAX_HEIGHT * 0.84,
    315,
  )
  const MIN_HEIGHT = spotCardHeightMode === 'full'
    ? isLandscapeFullSpotCard
      ? LANDSCAPE_FULL_COLLAPSED_HEIGHT
      : FULL_HEIGHT
    : COMPACT_HEIGHT
  const cardHeight = Math.min(cardHeightValue, MAX_HEIGHT)
  const setCardHeight = (height) => {
    const nextHeight = Math.min(height, MAX_HEIGHT)
    setCardHeightValue(nextHeight)
    setCardIsExpanded(
      spotCardHeightMode === 'full' && nextHeight >= MAX_HEIGHT * 0.85,
    )
  }
  const SHEET_RADIUS = 20

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Image === 'undefined' || imgs.length === 0) {
      return undefined
    }

    let cancelled = false
    let idleId = null

    const preloadImages = () => {
      if (cancelled) return

      imgs.forEach((url, index) => {
        const img = new Image()
        img.decoding = 'async'
        img.fetchPriority = index === 0 ? 'high' : 'low'
        img.src = url
        img.decode?.().catch(() => {})
      })
    }

    const timeoutId = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(preloadImages, { timeout: 1500 })
      } else {
        preloadImages()
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [imgs, imagesKey])

  // Trigger animation on mount
  useEffect(() => {
    if (selectedId) {
      const parentHeight = cardRef.current?.parentElement?.clientHeight
      const measuredMaxHeight = Math.max(320, parentHeight || WIN_H)
      if (parentHeight) setSheetMaxHeight(parentHeight)

      // Use the measured sheet limit for the first collapsed height. In landscape,
      // the available sheet height can be much shorter than the viewport; using
      // the viewport-derived value here can make the initial card look expanded.
      const initialMinHeight = spotCardHeightMode === 'full'
        ? isLandscapeFullSpotCard
          ? Math.min(
              Math.max(WIN_H * 0.68, 240),
              measuredMaxHeight * 0.84,
              315,
            )
          : FULL_HEIGHT
        : COMPACT_HEIGHT

      const previousSpot = previousSpotRef.current
      const isSameCardType =
        previousSpot?.heightMode === spotCardHeightMode

      previousSpotRef.current = {
        id: selectedId,
        heightMode: spotCardHeightMode,
      }

      // Keep a visible sheet in place when another marker opens the same card
      // type. Re-running the entrance animation here caused a noticeable hitch.
      if (previousSpot?.id !== selectedId && isSameCardType) {
        setClosing(false)
        return
      }

      // Updating the selected record for the current marker should not restart
      // the card animation either.
      if (previousSpot?.id === selectedId) return

      setIsVisible(false)
      setCardHeightValue(initialMinHeight)
      setCardIsExpanded(false)
      setClosing(false)
      // Trigger animation on next frame
      requestAnimationFrame(() => setIsVisible(true))
    }
  }, [selectedId, MIN_HEIGHT, spotCardHeightMode, WIN_H, isLandscapeFullSpotCard, FULL_HEIGHT, COMPACT_HEIGHT])

  useEffect(() => {
    if (!selectedId) return undefined

    const measureSheet = () => {
      const parentHeight = cardRef.current?.parentElement?.clientHeight
      if (parentHeight) setSheetMaxHeight(parentHeight)

      const viewportHeight = window.innerHeight || 700
      const nextMaxHeight = Math.max(320, parentHeight || viewportHeight)
      const landscapeFullMode =
        spotCardHeightMode === 'full' &&
        window.matchMedia('(orientation: landscape) and (max-height: 600px)').matches
      const nextMinHeight = spotCardHeightMode === 'full'
        ? landscapeFullMode
          ? Math.min(
              Math.max(viewportHeight * 0.68, 240),
              nextMaxHeight * 0.84,
              315,
            )
          : Math.min(viewportHeight * 0.44, 315)
        : Math.min(viewportHeight * 0.22, 150)

      setCardHeightValue(cardIsExpanded ? nextMaxHeight : nextMinHeight)
    }

    measureSheet()
    window.addEventListener('resize', measureSheet)
    window.addEventListener('orientationchange', measureSheet)
    return () => {
      window.removeEventListener('resize', measureSheet)
      window.removeEventListener('orientationchange', measureSheet)
    }
  }, [selectedId, spotCardHeightMode, selected?.spot_card_height, cardIsExpanded])

  // Watch dark mode changes
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined

    const syncDarkMode = () => setDarkMode(isDarkMode())

    const observer = new MutationObserver(syncDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    syncDarkMode()
    return () => observer.disconnect()
  }, [])

  const triggerClose = () => {
    onClosingStart?.()
    setClosing(true)
    setTimeout(() => onClose(), 320)
  }

  const snapTo = (height) => setCardHeight(height)

  const handleTouchStart = (e) => {
    startYRef.current = e.touches[0].clientY
    lastYRef.current = e.touches[0].clientY
    startHeightRef.current = spotCardHeightMode === 'full'
      ? cardHeight
      : cardRef.current?.offsetHeight || MIN_HEIGHT
    const scrollableContent = e.target.closest?.('.spot-card-expanded-content')
    const landscapeReviewGuide = e.target.closest?.('.spot-card-landscape-review-guide')
    const canScrollLandscapeGuide = Boolean(landscapeReviewGuide && isLandscapeExpandedSpotCard)
    const canScrollCardContent = Boolean(
      scrollableContent &&
      spotCardHeightMode === 'full' &&
      !isCollapsed &&
      window.matchMedia('(orientation: portrait) and (max-width: 380px) and (max-height: 660px)').matches,
    ) || canScrollLandscapeGuide
    contentScrollTouchRef.current = canScrollCardContent
      ? { element: canScrollLandscapeGuide ? landscapeReviewGuide : scrollableContent, mode: 'content' }
      : null
    setIsDragging(!canScrollCardContent)
  }

  const handleTouchMove = (e) => {
    lastYRef.current = e.touches[0].clientY
    const delta = startYRef.current - e.touches[0].clientY

    const contentTouch = contentScrollTouchRef.current
    if (contentTouch) {
      const { element } = contentTouch
      const atTop = element.scrollTop <= 0
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1
      if (delta > 0 && !atBottom) {
        contentTouch.mode = 'content'
        setIsDragging(false)
        return
      }
      if (delta < 0 && !atTop) {
        contentTouch.mode = 'content'
        setIsDragging(false)
        return
      }
      if (delta > 0 && atBottom) {
        contentTouch.mode = 'content'
        setIsDragging(false)
        return
      }
      if (delta < 0 && atTop) {
        contentTouch.mode = 'sheet'
        setIsDragging(true)
      }
    }

    if (!isDragging && contentTouch?.mode !== 'sheet') return

    // Prevent scroll when clearly vertical swipe (like membership card)
    if (Math.abs(delta) > 10) {
      e.preventDefault()
    }
    // Snapping happens in handleTouchEnd.
  }

  const handleTouchEnd = () => {
    const contentTouch = contentScrollTouchRef.current
    contentScrollTouchRef.current = null
    setIsDragging(false)

    if (contentTouch && contentTouch.mode !== 'sheet') return

    const delta = startYRef.current - lastYRef.current
    const startH = startHeightRef.current

    const wasMax = startH >= MAX_HEIGHT * 0.85
    const wasMin = startH <= MIN_HEIGHT * 1.15

    if (spotCardHeightMode !== 'full') {
      if (delta < -40) triggerClose()
      return
    }

    if (delta > 40) {
      snapTo(MAX_HEIGHT)
    } else if (delta < -40) {
      if (wasMax) snapTo(MIN_HEIGHT)
      else if (wasMin) triggerClose()
      else snapTo(MIN_HEIGHT)
    } else {
      const mid = (MIN_HEIGHT + MAX_HEIGHT) / 2
      snapTo(startH >= mid ? MAX_HEIGHT : MIN_HEIGHT)
    }
  }

  const isMax = spotCardHeightMode === 'full'
    ? cardIsExpanded
    : cardHeight >= MAX_HEIGHT * 0.85
  const isCollapsed = spotCardHeightMode === 'full'
    ? !cardIsExpanded
    : cardHeight < MAX_HEIGHT * 0.85
  const isLandscapeExpandedSpotCard =
    spotCardHeightMode === 'full' &&
    !isCollapsed &&
    typeof window !== 'undefined' &&
    window.matchMedia('(orientation: landscape) and (max-height: 600px)').matches
  const isLandscapeFullMode =
    spotCardHeightMode === 'full' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(orientation: landscape) and (max-height: 600px)').matches

  useEffect(() => {
    if (isLandscapeExpandedSpotCard) {
      setKeepLandscapeExpandedLayout(true)
      return undefined
    }

    if (!isLandscapeFullMode) {
      setKeepLandscapeExpandedLayout(false)
      return undefined
    }

    if (!keepLandscapeExpandedLayout) return undefined

    const timeoutId = window.setTimeout(() => setKeepLandscapeExpandedLayout(false), 320)
    return () => window.clearTimeout(timeoutId)
  }, [isLandscapeExpandedSpotCard, isLandscapeFullMode, keepLandscapeExpandedLayout])

  const shouldUseLandscapeExpandedLayout =
    isLandscapeExpandedSpotCard || keepLandscapeExpandedLayout

  const isTallCollapsed = isTallSpotCard && isCollapsed
  const showFixedGoogleMapsButton =
    spotCardHeightMode !== 'full' || isCollapsed || isLandscapeFullMode
  const googleMapsReservedSpace = spotCardHeightMode === 'full'
    ? shouldUseLandscapeExpandedLayout
      ? 0
      : isCollapsed
        ? 86
        : 56
    : 64
  const speechBubbleGapPx = isTallSpotCard && !hasImages
    ? isCollapsed
      ? 8
      : 16
    : 32
  // default: show stars unless admin explicitly turned them off
  const showRating = selected.show_rating !== false
  // Keep the action enabled for existing spots until an admin explicitly hides it.
  const showGoogleMapsButton = selected.show_google_maps_button !== false
  const shouldCenterGoogleMapsButtonInPortrait =
    spotCardHeightMode === 'full' &&
    isCollapsed &&
    typeof window !== 'undefined' &&
    window.matchMedia('(orientation: portrait)').matches

  useEffect(() => {
    if (!selectedId || !showGoogleMapsButton || !shouldCenterGoogleMapsButtonInPortrait) {
      setGoogleMapsButtonCenterY(null)
      return undefined
    }

    const imageBox = cardRef.current?.querySelector(
      '.spot-card-short-photo-strip, .spot-card-short-photo-placeholder',
    )
    const bottomTabs = document.querySelector('.app-landscape-bottom-tabs')
    if (!imageBox || !bottomTabs) {
      setGoogleMapsButtonCenterY(null)
      return undefined
    }

    let animationFrame = null
    let settleFrame = null
    let settleUntil = 0
    const updateCenter = () => {
      if (!window.matchMedia('(orientation: portrait)').matches) {
        setGoogleMapsButtonCenterY(null)
        return
      }
      const imageBottom = imageBox.getBoundingClientRect().bottom
      const tabsTop = bottomTabs.getBoundingClientRect().top
      const nextCenter = (imageBottom + tabsTop) / 2
      if (Number.isFinite(nextCenter)) {
        setGoogleMapsButtonCenterY((current) =>
          current == null || Math.abs(current - nextCenter) > 1 ? nextCenter : current,
        )
      }
    }
    const trackSheetTransition = (timestamp) => {
      updateCenter()
      if (timestamp < settleUntil) {
        settleFrame = window.requestAnimationFrame(trackSheetTransition)
      }
    }
    const startTracking = () => {
      if (settleFrame != null) window.cancelAnimationFrame(settleFrame)
      settleUntil = performance.now() + 360
      settleFrame = window.requestAnimationFrame(trackSheetTransition)
    }

    updateCenter()
    animationFrame = window.requestAnimationFrame(startTracking)
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateCenter)
      : null
    observer?.observe(imageBox)
    observer?.observe(bottomTabs)
    if (googleMapsButtonRef.current) observer?.observe(googleMapsButtonRef.current)
    window.addEventListener('resize', startTracking)
    window.addEventListener('orientationchange', startTracking)

    return () => {
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      if (settleFrame != null) window.cancelAnimationFrame(settleFrame)
      observer?.disconnect()
      window.removeEventListener('resize', startTracking)
      window.removeEventListener('orientationchange', startTracking)
    }
  }, [
    selectedId,
    showGoogleMapsButton,
    shouldCenterGoogleMapsButtonInPortrait,
    hasImages,
    imgs.length,
    cardHeight,
    isVisible,
    closing,
  ])
  const ratingSummary = summary?.store_id === selected?.partnership_id
    ? summary
    : null
  const reviewCount = ratingSummary?.review_count ?? 0
  const averageRating = ratingSummary?.average_rating ?? 0
  const usullangStarCount = Math.max(
    0,
    Math.min(3, Number(selected.usullang_star_count) || 0),
  )
  const showUsullangStars = selected.show_usullang_stars === true

  // treat empty / whitespace / HTML-only as empty (no ※)
  const rawTerms = selected.discount_terms ?? ''
  const cleanedTerms = rawTerms
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, '')
    .replace(/\s/g, '')
  const discountTerms = cleanedTerms ? selected.discount_terms : null

  const currentCardHeight = cardHeight || MIN_HEIGHT
  const sheetRestingOffset = Math.max(0, MAX_HEIGHT - currentCardHeight)
  const fixedButtonHiddenOffset = Math.max(
    0,
    MAX_HEIGHT * 1.1 - sheetRestingOffset,
  )
  const sheetTranslateY = closing || !isVisible
    ? '110%'
    : `${sheetRestingOffset}px`

  const sheetStyle = {
    height: MAX_HEIGHT + 'px',
    transform: closing
      ? 'translateY(110%)'
      : `translateY(${sheetTranslateY})`,
    transition: isDragging
      ? 'none'
      : 'transform 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s cubic-bezier(0.4,0,0.2,1)',
    willChange: 'transform',
  }

  const handleReviewBoxTouchStart = (event) => {
    reviewBoxTouchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      axis: null,
    }
  }

  const handleReviewBoxTouchMove = (event) => {
    const touchStart = reviewBoxTouchStartRef.current
    if (!touchStart) return

    const distanceX = event.touches[0].clientX - touchStart.x
    const distanceY = event.touches[0].clientY - touchStart.y
    const absX = Math.abs(distanceX)
    const absY = Math.abs(distanceY)

    if (!touchStart.axis && Math.max(absX, absY) > 8) {
      // Diagonal gestures stay vertical; only a clearly horizontal gesture
      // can switch review panels.
      touchStart.axis = absX > absY * 1.5 ? 'x' : 'y'
    }

    if (touchStart.axis === 'x') {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const handleReviewBoxTouchEnd = (event) => {
    if (reviewBoxTouchStartRef.current == null) return

    const distanceX = event.changedTouches[0].clientX - reviewBoxTouchStartRef.current.x
    if (reviewBoxTouchStartRef.current.axis === 'x') {
      event.stopPropagation()
      if (distanceX < -40) setReviewBoxPanel('notes')
      if (distanceX > 40) setReviewBoxPanel('guide')
    }
    reviewBoxTouchStartRef.current = null
  }

  const guideContent = (selected.one_line_review || showUsullangStars) && (!isTallCollapsed || !hasImages) && (
    <div
      className="spot-card-review-guide-content mb-3"
      style={{ marginTop: spotCardHeightMode === 'full' ? 8 : speechBubbleGapPx }}
    >
      <div className="spot-card-landscape-usullang">
        <p className="mb-2 text-left text-xs font-semibold text-gray-500">
          우슐랭
        </p>
        {spotCardHeightMode === 'full' && showUsullangStars && (
          <div
            className="spot-card-compact-stars mb-6 flex items-center justify-center gap-3 text-orange-500"
            aria-label={`우슐랭 별 ${usullangStarCount}개`}
          >
            {Array.from({ length: 3 }).map((_, index) => (
              <StarFour
                key={index}
                size={66}
                weight={index < usullangStarCount ? 'fill' : 'regular'}
                color={
                  index < usullangStarCount
                    ? '#f97316'
                    : darkMode
                      ? DARK_MUTED_ACCENT
                      : '#d1d5db'
                }
              />
            ))}
          </div>
        )}
      </div>
      {selected.one_line_review && (
        <div className="spot-card-landscape-speech-bubble relative w-full">
          <div
            aria-hidden="true"
            className="block w-[97.5%] origin-left select-none"
            style={{
              aspectRatio: '3435 / 612',
              backgroundColor: '#f97316',
              mask: 'url(/spotcard-speech-bubble.png) center / contain no-repeat',
              WebkitMask:
                'url(/spotcard-speech-bubble.png) center / contain no-repeat',
            }}
          />
          <div
            className="spot-card-landscape-speech-overlay absolute flex items-center justify-center px-6 sm:px-8 md:px-10"
            style={{
              left: '8%',
              right: '8%',
              top: '10%',
              bottom: '15%',
              overflow: 'hidden',
            }}
          >
            <RichText
              text={selected.one_line_review}
              className="spot-card-landscape-speech-text block max-w-full break-keep text-center text-[clamp(12px,3.2vw,16px)] font-semibold leading-tight text-white"
            />
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {lightboxIndex !== null && (
        <Lightbox
          imgs={imgs}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <div
        ref={cardRef}
        className="spot-card-sheet absolute bottom-0 left-0 right-0 bg-white"
        style={{
          ...sheetStyle,
          zIndex: 1000,
          boxShadow: '0 -4px 24px rgba(0,0,0,0.13)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderTopLeftRadius: isMax ? 0 : SHEET_RADIUS,
          borderTopRightRadius: isMax ? 0 : SHEET_RADIUS,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={(e) => {
          const landscapeReviewGuide = e.target.closest?.('.spot-card-landscape-review-guide')
          const canScrollLandscapeGuide = Boolean(
            landscapeReviewGuide &&
            isLandscapeExpandedSpotCard &&
            ((e.deltaY > 0 && landscapeReviewGuide.scrollTop + landscapeReviewGuide.clientHeight < landscapeReviewGuide.scrollHeight - 1) ||
              (e.deltaY < 0 && landscapeReviewGuide.scrollTop > 0)),
          )
          if (canScrollLandscapeGuide) return

          const scrollableContent = e.target.closest?.('.spot-card-expanded-content')
          const canScrollContent = Boolean(
            scrollableContent &&
            spotCardHeightMode === 'full' &&
            !isCollapsed &&
            window.matchMedia('(orientation: portrait) and (max-width: 380px) and (max-height: 660px)').matches &&
            ((e.deltaY > 0 && scrollableContent.scrollTop + scrollableContent.clientHeight < scrollableContent.scrollHeight - 1) ||
              (e.deltaY < 0 && scrollableContent.scrollTop > 0)),
          )
          if (canScrollContent) return

          if (spotCardHeightMode !== 'full') {
            if (e.deltaY < 0) triggerClose()
          } else {
            if (e.deltaY > 0) snapTo(MAX_HEIGHT)
            else if (e.deltaY < 0) {
              if (cardHeight >= MAX_HEIGHT * 0.85) snapTo(MIN_HEIGHT)
              else triggerClose()
            }
          }
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div
          className={
            'flex-1 px-5 ' +
            (spotCardHeightMode === 'full' && !isCollapsed
              ? 'spot-card-expanded-content'
              : '') +
            (isLandscapeFullMode
              ? ' spot-card-landscape-expanded-content'
              : '')
          }
          style={{ overflowY: 'hidden' }}
        >
          {/* ?? Place info ?? */}
          <div className={`spot-card-place-info pt-1 pb-3 ${isLandscapeExpandedSpotCard ? 'spot-card-landscape-place-info-hidden' : ''}`}>
            {/* Store name */}
            <div className="flex items-center gap-2">
              <p className="spot-card-title font-semibold text-gray-900">
                {selected.name}
              </p>
            </div>
            {spotCardHeightMode === 'full' && showRating && (
              <div className="flex items-center gap-1 mt-1">
                <StarDisplay
                  averageRating={averageRating}
                  showWhenZero
                  showAverage={reviewCount > 0}
                  darkMode={darkMode}
                />
                <span className="text-xs text-gray-400">({reviewCount})</span>
              </div>
            )}

            {/* Description, discount, address */}
            {selected.description && (
              <RichText
                text={selected.description}
                className="text-xs text-gray-500 mt-1 block"
              />
            )}

            {selected.discount_info && (
              <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
                <Ticket size={14} weight="fill" color="#FF5252" />
                <RichText text={selected.discount_info} />
              </p>
            )}

            {discountTerms && (
              <p className="text-xs text-gray-800 mt-0.5">
                ※ <RichText text={discountTerms} />
              </p>
            )}

            {selected.address && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <MapPin size={12} weight="fill" />
                {selected.address}
              </p>
            )}
          </div>

          <div className={shouldUseLandscapeExpandedLayout ? 'spot-card-landscape-expanded-grid' : ''}>
            {/* Images */}
            {spotCardHeightMode === 'full' && !shouldUseLandscapeExpandedLayout && (hasImages ? (
              <div className="spot-card-short-photo-strip mb-2">
                <ImageThumbnails
                  imgs={imgs}
                  onTap={(i) => setLightboxIndex(i)}
                  darkMode={darkMode}
                />
              </div>
            ) : (
              <div
                className="spot-card-short-photo-placeholder mb-3 flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100"
                style={{ width: '100px', height: '125px' }}
                aria-label="이미지 없음"
              >
                <ImageIcon size={30} weight="regular" className="text-gray-400" />
                <span className="text-xs text-gray-400">No images</span>
              </div>
            ))}

            {/* Review box: swipe left for member notes. */}
            {spotCardHeightMode === 'full' && !isTallCollapsed && (
              <section
                className={`mt-6 mb-3 flex h-[380px] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 transition-all duration-300 ease-out ${shouldUseLandscapeExpandedLayout ? 'spot-card-landscape-review-box' : ''}`}
                aria-label="리뷰 박스"
                onTouchStart={handleReviewBoxTouchStart}
                onTouchMove={handleReviewBoxTouchMove}
                onTouchEnd={handleReviewBoxTouchEnd}
                style={{
                  opacity: isCollapsed ? 0 : 1,
                  transform: isCollapsed ? 'translateY(8px)' : 'translateY(0)',
                  visibility: isCollapsed ? 'hidden' : 'visible',
                  pointerEvents: isCollapsed ? 'none' : 'auto',
                  transitionProperty: 'opacity, transform, visibility',
                  transitionDelay: isCollapsed ? '0s, 0s, 0.3s' : '0s',
                }}
              >
              <div
                className="flex min-h-0 w-[200%] flex-1 transition-transform duration-300 ease-out"
                style={{
                  transform: reviewBoxPanel === 'notes'
                    ? 'translateX(-50%)'
                    : 'translateX(0)',
                }}
              >
                <div className="spot-card-review-guide w-1/2 flex-shrink-0 px-4 pt-1">
                  {guideContent}
                  <div className="spot-card-landscape-member-evaluation">
                    <TagBarChart
                      tagCounts={ratingSummary?.tag_counts}
                      reviewCount={reviewCount}
                    />
                  </div>
                </div>
                <div className="w-1/2 flex-shrink-0 px-4">
                  {reviewAudience === 'member' ? (
                    <GoodToKnowNotesPanel
                      restaurantId={selected.id}
                      userId={currentUserId}
                      userEmail={currentUserEmail}
                      username={currentUsername}
                      canComment={canComment}
                      isAdmin={isAdmin}
                      mutedAccentColor={darkMode ? DARK_MUTED_ACCENT : undefined}
                    />
                  ) : (
                    <div className="flex h-full min-h-0 flex-col py-3">
                      <p className="text-xs font-semibold text-gray-500">가본 사람 한마디</p>
                      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
                        <p className="text-center text-xs leading-relaxed text-gray-400">
                          로그인하면 가본 사람 한마디를 읽고 작성할 수 있어요
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="spot-card-review-pagination relative z-10 flex flex-shrink-0 justify-center gap-1.5 bg-gray-50 pb-4 pt-4" aria-hidden="true">
                <span className={
                  'h-1.5 rounded-full transition-all ' +
                  (reviewBoxPanel === 'guide' ? 'w-4 bg-orange-500' : 'w-1.5 bg-gray-300')
                } />
                <span className={
                  'h-1.5 rounded-full transition-all ' +
                  (reviewBoxPanel === 'notes' ? 'w-4 bg-orange-500' : 'w-1.5 bg-gray-300')
                } />
              </div>
              </section>
            )}
          </div>

          {/* 한 줄 평가 */}
          {spotCardHeightMode !== 'full' && (selected.one_line_review || showUsullangStars) && (!isTallCollapsed || !hasImages) && (
            <div className="mb-3" style={{ marginTop: speechBubbleGapPx }}>
              <p className="mb-2 text-left text-xs font-semibold text-gray-500">
                우슐랭
              </p>
              {showUsullangStars && (
                <div
                  className="mb-6 flex items-center justify-center gap-3 text-orange-500"
                  aria-label={`우슐랭 별 ${usullangStarCount}개`}
                >
                  {Array.from({ length: 3 }).map((_, index) => (
                    <StarFour
                      key={index}
                      size={44}
                      weight={index < usullangStarCount ? 'fill' : 'regular'}
                      color={index < usullangStarCount ? '#f97316' : darkMode ? DARK_MUTED_ACCENT : '#d1d5db'}
                    />
                  ))}
                </div>
              )}
              {selected.one_line_review && <div className="relative w-full">
                <div
                  aria-hidden="true"
                  className="block w-[97.5%] origin-left select-none"
                  style={{
                    aspectRatio: '3435 / 612',
                    backgroundColor: '#f97316',
                    mask: 'url(/spotcard-speech-bubble.png) center / contain no-repeat',
                    WebkitMask:
                      'url(/spotcard-speech-bubble.png) center / contain no-repeat',
                  }}
                />

                <div
                  className="absolute flex items-center justify-center px-6 sm:px-8 md:px-10"
                  style={{
                    left: '8%',
                    right: '8%',
                    top: '10%',
                    bottom: '15%',
                    overflow: 'hidden',
                  }}
                >
                  <RichText
                    text={selected.one_line_review}
                    className="block max-w-full break-keep text-center text-[clamp(14px,4vw,18px)] font-semibold leading-tight text-white"
                  />
                </div>
              </div>}
            </div>
          )}

          {/* 임원 리뷰 */}
          {spotCardHeightMode !== 'full' && !isTallCollapsed && (selected.review || selected.reviewer_name) && (
            <div className="pb-4">
              <div className="pt-3">
                <p className="mb-1.5 text-xs font-semibold text-gray-500">
                  임원 추천 메뉴
                </p>
                {selected.review && (
                  <RichText
                    text={selected.review}
                    className="block pl-4 text-xs text-gray-600"
                  />
                )}
                {selected.reviewer_name && (
                  <p className="mt-0.5 pl-4 text-xs text-gray-400">
                    {'— ' + selected.reviewer_name}
                  </p>
                )}
              </div>
            </div>
          )}

          <div style={{ height: googleMapsReservedSpace }} />
        </div>

      </div>

      {/* Fixed outside the moving sheet so it remains in one place over the SpotCard. */}
      {showGoogleMapsButton && (
        <div
          ref={googleMapsButtonRef}
          className={
            'spot-card-google-maps-button fixed left-0 right-0 pointer-events-none flex justify-center transition-opacity duration-200 ' +
            (showFixedGoogleMapsButton ? 'opacity-100' : 'opacity-0')
          }
          style={{
            ...(googleMapsButtonCenterY == null
              ? { bottom: 'calc(env(safe-area-inset-bottom) + 115px)' }
              : { top: `${googleMapsButtonCenterY}px`, bottom: 'auto' }),
            zIndex: 1020,
            transform:
              closing || !isVisible
                ? `translateY(calc(-50% + ${fixedButtonHiddenOffset}px))`
                : googleMapsButtonCenterY == null
                  ? 'translateY(0)'
                  : 'translateY(-50%)',
            willChange: 'opacity, transform',
          }}
        >
            <a
              href={
                'https://www.google.com/maps/search/?api=1&query=' +
                encodeURIComponent(
                  selected.name + ' ' + (selected.address || ''),
                )
              }
              target="_blank"
              rel="noopener noreferrer"
              className={
                'bg-orange-500 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-1.5 ' +
                (showFixedGoogleMapsButton ? 'pointer-events-auto' : 'pointer-events-none')
              }
              onTouchStart={(e) => e.stopPropagation()}
            >
              <MapPin size={14} weight="fill" />
              Google Maps에서 열기
            </a>
        </div>
      )}
    </>
  )
}

