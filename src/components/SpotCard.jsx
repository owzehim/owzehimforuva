import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, MapPin, Ticket, Star } from '@phosphor-icons/react'
import { CATEGORY_ICONS } from '../lib/mapCategories'
import { BowlSteam, HandHeart, Wine, CoinVertical } from '@phosphor-icons/react'
import { useStoreReviewSummary } from '../hooks/useStoreReviewSummary'
import { computeStarDisplay, getSortedTagsForDisplay, formatAverageRating } from '../domain/reviewDomain'
import { REVIEW_TAGS } from '../domain/reviewTypes'

export function RichText({ text, className = '' }) {
  if (!text) return null
  return <span className={className} dangerouslySetInnerHTML={{ __html: text }} />
}

const TAG_ICON_COMPONENTS = {
  BowlSteam,
  HandHeart,
  Wine,
  CoinVertical,
}

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
  const emptyColor = darkMode ? '#4b5563' : '#d1d5db' // gray-600 vs gray-300

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
  const sorted = getSortedTagsForDisplay(tagCounts)
  const hasMemberReviews = reviewCount > 0 && sorted.length > 0
  const displayTags = hasMemberReviews
    ? sorted
    : REVIEW_TAGS.map((tag) => ({ ...tag, count: 0 }))
  const maxCount = hasMemberReviews ? sorted[0].count : 0

  return (
    <div className="pb-4">
      <div className="pt-3">
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-500">
            멤버 평가
          </p>
        </div>

        <div className="flex flex-col gap-2.5 pl-4">
          {displayTags.map((tag) => {
            const IconComponent = TAG_ICON_COMPONENTS[tag.icon]
            const pct =
              maxCount > 0 ? Math.round((tag.count / maxCount) * 100) : 0

            return (
              <div key={tag.key} className="flex items-center gap-2">
                <div className="flex items-center gap-1 w-28 flex-shrink-0">
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

function Lightbox({ imgs, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex)
  const [visible, setVisible] = useState(false)
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const lightboxDotsBottom = 'calc(env(safe-area-inset-bottom) + 10px)'

  const goToIndex = (nextIndex) => {
    const clampedIndex = Math.max(0, Math.min(nextIndex, imgs.length - 1))
    if (clampedIndex === index) return
    setIndex(clampedIndex)
  }

  // zoom-in + fade-in on open
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
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

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight') goToIndex(index + 1)
      if (e.key === 'ArrowLeft') goToIndex(index - 1)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [imgs.length, index])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => onClose(), 250)
  }

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e) => {
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

      <div
        onClick={handleClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
        <div
          onClick={(e) => e.stopPropagation()}
          className={visible ? 'lightbox-zoom-enter' : ''}
          style={{
            width: '100%',
            maxWidth: '90vw',
            height: '90vh',
            maxHeight: '90vh',
            overflow: 'hidden',
            transform: 'translateY(-18px)',
          }}
        >
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
                  src={src}
                  alt={'Photo ' + (imgIndex + 1)}
                  decoding="async"
                  fetchPriority={imgIndex === index ? 'high' : 'auto'}
                  loading={Math.abs(imgIndex - index) <= 1 ? 'eager' : 'lazy'}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    borderRadius: 12,
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Dots */}
        {imgs.length > 1 && (
          <div
            style={{
              position: 'absolute',
              bottom: lightboxDotsBottom,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {imgs.map((_, i) => (
              <div
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  goToIndex(i)
                }}
                style={{
                  width: i === index ? 8 : 6,
                  height: i === index ? 8 : 6,
                  borderRadius: '999px',
                  background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ?? Thumbnail grid (same on mobile + desktop) ???????????????????

function ImageThumbnails({ imgs, onTap }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {imgs.map((url, i) => (
        <div
          key={`${url}-${i}`}
          onClick={() => onTap(i)}
          className="flex-shrink-0 rounded-xl overflow-hidden bg-gray-100"
          style={{
            width: '100px',
            height: '125px',
            cursor: 'zoom-in',
          }}
        >
          <img
            src={url}
            alt={'사진 ' + (i + 1)}
            loading="eager"
            decoding="async"
            fetchPriority={i === 0 ? 'high' : 'low'}
            style={{
              width: '100px',
              height: '125px',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      ))}
    </div>
  )
}

export function SpotCard({
  selected,
  onClose,
  onClosingStart,
}) {
  const [cardHeight, setCardHeight] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [isVisible, setIsVisible] = useState(false)
  const [darkMode, setDarkMode] = useState(() => isDarkMode())
  const [sheetMaxHeight, setSheetMaxHeight] = useState(0)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const lastYRef = useRef(0)
  const cardRef = useRef(null)
  const previousSpotRef = useRef(null)

  const imgs = selected['image_urls'] || []
  const imagesKey = imgs.join('|')
  const hasImages = imgs.length > 0

  const { summary } = useStoreReviewSummary(
    selected?.partnership_id,
  )

  const { WIN_H, WIN_W } = useMemo(
    () => ({
      WIN_H: typeof window !== 'undefined' ? window.innerHeight : 700,
      WIN_W: typeof window !== 'undefined' ? window.innerWidth : 1024,
    }),
    [],
  )

  const isDesktop = WIN_W >= 768
  const isTallSpotCard = selected?.spot_card_height === 'tall'
  const spotCardHeightMode =
    selected?.spot_card_height === 'full' || selected?.spot_card_height === 'tall'
      ? 'full'
      : 'compact'
  const COMPACT_HEIGHT = Math.min(WIN_H * 0.22, 150)
  const FULL_HEIGHT = Math.min(WIN_H * 0.38, 260)
  const MIN_HEIGHT = spotCardHeightMode === 'full' ? FULL_HEIGHT : COMPACT_HEIGHT
  const MAX_HEIGHT = isDesktop ? 460 : Math.max(320, sheetMaxHeight || WIN_H)
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
    if (selected) {
      const parentHeight = cardRef.current?.parentElement?.clientHeight
      if (parentHeight) setSheetMaxHeight(parentHeight)

      const previousSpot = previousSpotRef.current
      const isSameCardType =
        previousSpot?.heightMode === spotCardHeightMode

      previousSpotRef.current = {
        id: selected.id,
        heightMode: spotCardHeightMode,
      }

      // Keep a visible sheet in place when another marker opens the same card
      // type. Re-running the entrance animation here caused a noticeable hitch.
      if (previousSpot?.id !== selected.id && isSameCardType) {
        setClosing(false)
        return
      }

      // Updating the selected record for the current marker should not restart
      // the card animation either.
      if (previousSpot?.id === selected.id) return

      setIsVisible(false)
      setCardHeight(MIN_HEIGHT)
      setClosing(false)
      // Trigger animation on next frame
      requestAnimationFrame(() => setIsVisible(true))
    }
  }, [selected?.id, MIN_HEIGHT, spotCardHeightMode])

  useEffect(() => {
    if (!selected || isDesktop) return undefined

    const measureSheet = () => {
      const parentHeight = cardRef.current?.parentElement?.clientHeight
      if (parentHeight) setSheetMaxHeight(parentHeight)
    }

    measureSheet()
    window.addEventListener('resize', measureSheet)
    return () => window.removeEventListener('resize', measureSheet)
  }, [selected, isDesktop])

  useEffect(() => {
    if (cardHeight > MAX_HEIGHT) setCardHeight(MAX_HEIGHT)
  }, [cardHeight, MAX_HEIGHT])

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
    setIsDragging(true)
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return

    lastYRef.current = e.touches[0].clientY
    const delta = startYRef.current - e.touches[0].clientY

    // Prevent scroll when clearly vertical swipe (like membership card)
    if (Math.abs(delta) > 10) {
      e.preventDefault()
    }
    // Snapping happens in handleTouchEnd.
  }

  const handleTouchEnd = () => {
    setIsDragging(false)

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

  const isMax = cardHeight >= MAX_HEIGHT * 0.85
  const isCollapsed = cardHeight < MAX_HEIGHT * 0.85
  const isTallCollapsed = isTallSpotCard && isCollapsed
  const speechBubbleGapPx = isTallSpotCard && !hasImages
    ? isCollapsed
      ? 8
      : 16
    : 32
  const iconSvg = CATEGORY_ICONS[selected.category]

  // default: show stars unless admin explicitly turned them off
  const showRating = selected.show_rating !== false
  // Keep the action enabled for existing spots until an admin explicitly hides it.
  const showGoogleMapsButton = selected.show_google_maps_button !== false
  const ratingSummary = summary?.store_id === selected?.partnership_id
    ? summary
    : null
  const reviewCount = ratingSummary?.review_count ?? 0
  const averageRating = ratingSummary?.average_rating ?? 0

  // treat empty / whitespace / HTML-only as empty (no ※)
  const rawTerms = selected.discount_terms ?? ''
  const cleanedTerms = rawTerms
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, '')
    .replace(/\s/g, '')
  const discountTerms = cleanedTerms ? selected.discount_terms : null

  const sheetTranslateY = closing || !isVisible
    ? '110%'
    : `${Math.max(0, MAX_HEIGHT - cardHeight)}px`

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
        className="absolute bottom-0 left-0 right-0 bg-white"
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

        <div className="flex-1 px-5" style={{ overflowY: 'hidden' }}>
          {/* ?? Place info ?? */}
          <div className="pt-1 pb-3">
            {/* Category / price / sponsored (currently hidden with false) */}
            {false && (
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                  {iconSvg && (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: iconSvg.replace(
                          'fill="currentColor"',
                          'fill="#f97316"',
                        ),
                      }}
                      style={{
                        width: '14px',
                        height: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    />
                  )}
                  {selected.category || '기타'}
                </span>

                {selected.price_range && (
                  <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
                    {selected.price_range}
                  </span>
                )}

                {selected.is_sponsored && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                    제휴
                  </span>
                )}
              </div>
            )}

            {/* Store name */}
            <p className="font-semibold text-gray-900 text-lg">
              {selected.name}
            </p>

            {showRating && (
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

          {/* Images */}
          {hasImages ? (
            <div className="mb-3">
              <ImageThumbnails
                imgs={imgs}
                onTap={(i) => setLightboxIndex(i)}
              />
            </div>
          ) : (
            <div
              className="mb-3 flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100"
              style={{ width: '100px', height: '125px' }}
              aria-label="이미지 없음"
            >
              <ImageIcon size={30} weight="regular" className="text-gray-400" />
              <span className="text-xs text-gray-400">No images</span>
            </div>
          )}

          {/* 한 줄 평가 */}
          {selected.one_line_review && (!isTallCollapsed || !hasImages) && (
            <div className="mb-3" style={{ marginTop: speechBubbleGapPx }}>
              <p className="mb-2 text-left text-xs font-semibold text-gray-500">
                우슐랭 평가
              </p>
              <div className="relative w-full">
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
              </div>
            </div>
          )}

          {/* Member review bar chart */}
          {!isTallCollapsed && (
            <TagBarChart
              tagCounts={ratingSummary?.tag_counts}
              reviewCount={reviewCount}
            />
          )}

          {/* 임원 리뷰 */}
          {!isTallCollapsed && (selected.review || selected.reviewer_name) && (
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

          <div className="pb-16" />
        </div>

      </div>

      {/* Fixed outside the moving sheet so it remains in one place over the SpotCard. */}
      {showGoogleMapsButton && (
        <div
          className="fixed left-0 right-0 pointer-events-none flex justify-center"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom) + 115px)',
            zIndex: 35,
            transform:
              closing || !isVisible ? 'translateY(160px)' : 'translateY(0)',
            transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
            willChange: 'transform',
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
              className="pointer-events-auto bg-orange-500 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-1.5"
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

