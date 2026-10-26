import { lazy, Suspense, useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SpotCard } from '../components/SpotCard'
import { MAP_CATEGORIES, CATEGORY_ICONS_WHITE, CATEGORY_ICONS_ORANGE, CATEGORY_ICONS_BLACK } from '../lib/mapCategories'
import { getVisibleMapCategories } from '../lib/mapCategoryVisibility'
import { MapPin, Lock, ForkKnife, Calendar, CalendarDots, Users } from '@phosphor-icons/react'
import { primeStoreReviewSummaries } from '../hooks/useStoreReviewSummary'
import { useDevInteractionLock } from '../lib/devInteractionLock'

const MapView = lazy(() => import('../components/MapView'))

const PUBLIC_ACTIVE_TAB_KEY = 'uvain_public_active_tab'
const PUBLIC_BOTTOM_TAB_PADDING = 'clamp(28px, 9.8vw, 42px)'

function getStoredPublicTab() {
  return 'membership'
}

export default function PublicPage() {
  const [activeTab, setActiveTab] = useState(getStoredPublicTab)
  const [hasOpenedMap, setHasOpenedMap] = useState(() => getStoredPublicTab() === 'map')
  const [restaurants, setRestaurants] = useState([])
  const navigate = useNavigate()
  const lockInteractions = useDevInteractionLock(activeTab !== 'map')

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo(0, 0)
      document.scrollingElement?.scrollTo?.(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }

    resetScroll()
    const frame = window.requestAnimationFrame(resetScroll)
    const shortTimer = window.setTimeout(resetScroll, 120)
    const keyboardTimer = window.setTimeout(resetScroll, 420)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(shortTimer)
      window.clearTimeout(keyboardTimer)
    }
  }, [])

  useEffect(() => {
    const fetchRestaurants = async () => {
      const { data } = await supabase
        .from('restaurants')
        .select('*')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      const loadedRestaurants = data || []
      setRestaurants(loadedRestaurants)
      // Review summaries enrich spot cards but should not delay the map itself.
      void primeStoreReviewSummaries(
        loadedRestaurants.map((restaurant) => restaurant.partnership_id),
      ).catch((error) => {
        console.warn('Failed to pre-load store review summaries:', error)
      })
    }
    fetchRestaurants()
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.touches.length === 1 && e.touches[0]?.clientX < 30) e.preventDefault()
    }
    document.addEventListener('touchstart', handler, { passive: false })
    return () => document.removeEventListener('touchstart', handler)
  }, [])

  return (
    <div
      className={
        'phone-app-shell viewport-height-shell flex flex-col overflow-hidden no-highlight-zone ' +
        (lockInteractions ? 'dev-no-zoom-selection ' : '') +
        (activeTab === 'membership'
          ? 'bg-black'
          : 'bg-white dark:bg-[#121212]')
      }
      style={{
        height: '100dvh',
        WebkitTapHighlightColor: 'transparent',
        touchAction: lockInteractions ? 'pan-x pan-y' : undefined,
      }}
    >
      <style>{`
        .no-highlight-zone,
        .no-highlight-zone * {
          -webkit-tap-highlight-color: transparent;
        }
        .membership-heading p + p {
          display: none;
        }
        .membership-carousel {
          --membership-dot-active: #111827;
          --membership-dot-idle: rgba(17, 24, 39, 0.32);
        }
        .dark .membership-carousel {
          --membership-dot-active: #ffffff;
          --membership-dot-idle: rgba(255, 255, 255, 0.4);
        }
      `}</style>

      <div
        className="relative bg-white flex items-center justify-between flex-shrink-0"
        style={{
          display: 'none',
          paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
          minHeight: 'calc(env(safe-area-inset-top) + 56px)',
        }}
      >
        <h1
          className="font-bold text-gray-900"
          style={{
            position: 'fixed',
            left: '32px',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          UvA-IN
        </h1>
        <button
          onClick={() => navigate('/login')}
          className="text-sm text-orange-500 font-medium rounded-lg hover:bg-orange-50"
          style={{
            position: 'fixed',
            right: '14px',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            height: '44px',
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          로그인
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div className="h-full" style={{ display: activeTab === 'membership' ? 'block' : 'none' }}>
          {activeTab === 'membership' && <MembershipCarousel />}
        </div>
        {hasOpenedMap && activeTab === 'map' && (
          <div className="absolute inset-0">
            <PublicMapTab restaurants={restaurants} active={activeTab === 'map'} />
          </div>
        )}
      </div>

      <div
        className="bg-white flex flex-shrink-0 select-none dark:bg-[#121212]"
        style={{
          paddingBottom: PUBLIC_BOTTOM_TAB_PADDING,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          position: 'relative',
          zIndex: 1030,
        }}
      >
        {[
          { key: 'membership', label: 'Membership', icon: Lock },
          { key: 'map', label: 'SPOT', icon: MapPin },
        ].map((tab) => {
          const IconComponent = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => {
                if (tab.key === activeTab) return

                window.sessionStorage.setItem(PUBLIC_ACTIVE_TAB_KEY, tab.key)
                setActiveTab(tab.key)
                if (tab.key === 'map') setHasOpenedMap(true)
              }}
              className={
                'flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors select-none ' +
                (activeTab === tab.key ? 'text-orange-500' : 'text-gray-400')
              }
              style={{
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <IconComponent size={20} weight={activeTab === tab.key ? 'fill' : 'regular'} />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PublicMapTab({ restaurants, active }) {
  const [selected, setSelected] = useState(null)
  const [activeCategory, setActiveCategory] = useState('전체')
  const [darkMode, setDarkMode] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined

    const syncDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains('dark'))
    }

    const observer = new MutationObserver(syncDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    syncDarkMode()
    return () => observer.disconnect()
  }, [])

  const visibleCategories = useMemo(
    () => getVisibleMapCategories(restaurants),
    [restaurants],
  )
  const selectedCategory = visibleCategories.includes(activeCategory)
    ? activeCategory
    : MAP_CATEGORIES[0]
  const filtered = useMemo(
    () => selectedCategory === MAP_CATEGORIES[0]
      ? restaurants
      : restaurants.filter((restaurant) => restaurant.category === selectedCategory),
    [restaurants, selectedCategory],
  )

  return (
    <div className="h-full flex flex-col no-highlight-zone">
      <div
        className="bg-white px-3 py-3 flex gap-2 overflow-x-auto flex-shrink-0 select-none dark:bg-[#121212]"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
          zIndex: 10,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
  {visibleCategories.map((cat) => {
    const isActive = selectedCategory === cat

    const iconSvg = isActive
      ? darkMode
        ? CATEGORY_ICONS_BLACK[cat]   // dark mode: black icon
        : CATEGORY_ICONS_WHITE[cat]   // light mode: white icon (as before)
      : CATEGORY_ICONS_ORANGE[cat]

    const activeTextClass = darkMode ? 'text-[#121212]' : 'text-white'

    return (
      <button
        key={cat}
        onClick={() => {
          setActiveCategory(cat)
          setSelected(null)
        }}
        className={
          'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 select-none ' +
          (isActive
            ? `bg-orange-500 ${activeTextClass}`
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
        }
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
        {cat}
      </button>
    )
  })}
</div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            {(() => {
              const iconSvg = CATEGORY_ICONS_ORANGE[selectedCategory]
              return (
                <div
                  style={{ width: 32, height: 32, margin: '0 auto 8px' }}
                  dangerouslySetInnerHTML={{ __html: iconSvg }}
                />
              )
            })()}
            <p className="text-gray-500 text-sm">등록된 장소가 없어요.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden no-highlight-zone">
          <Suspense fallback={null}>
            <MapView
              restaurants={filtered}
              selected={selected}
              onSelect={setSelected}
              active={active}
            />
          </Suspense>
          {selected && (
            <SpotCard
              selected={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

const MEMBERSHIP_IMAGE_BASE = '/PublicPage_MembershipTab_Images'

function membershipImage(filename) {
  return { src: `${MEMBERSHIP_IMAGE_BASE}/${filename}` }
}

const MEMBERSHIP_SLIDES = [
  {
    key: 'intro',
    title: (
      <>
        완벽한 UvA 캠퍼스 라이프,
        <br />
        UvA-IN
      </>
    ),
    description: '',
    images: [
      membershipImage('uva-campus-1.webp'),
      membershipImage('uva-campus-2.webp'),
      membershipImage('uva-campus-3.webp'),
      membershipImage('uva-campus-4.webp'),
    ],
  },
  {
    key: 'discounts',
    title: (
      <span className="inline-flex max-w-full items-center gap-[clamp(4px,1.3vw,7px)] whitespace-nowrap">
        <ForkKnife size="clamp(18px,6vw,26px)" weight="fill" color="#f97316" />
        <span className="whitespace-nowrap">로컬 맛집 & 카페 제휴 할인</span>
      </span>
    ),
    description: '암스테르담 곳곳의 제휴 매장 혜택',
    images: [
      membershipImage('restaurant-cafe-1.webp'),
      membershipImage('restaurant-cafe-2.webp'),
    ],
  },
  {
    key: 'events',
    title: (
      <span className="inline-flex max-w-full items-center gap-[clamp(4px,1.3vw,7px)] whitespace-nowrap">
        <CalendarDots size="clamp(18px,6vw,26px)" weight="fill" color="#3b82f6" />
        <span className="whitespace-nowrap">UvA-IN 이벤트 참여 혜택</span>
      </span>
    ),
    description: 'UvA-IN 독점 이벤트 지원 혜택 및 참가비 할인',
    images: [
      membershipImage('uvain-event-1.webp'),
    ],
  },
  {
    key: 'network',
    title: (
      <span className="inline-flex max-w-full items-center gap-[clamp(4px,1.3vw,7px)] whitespace-nowrap">
        <Users size="clamp(18px,6vw,26px)" weight="fill" color="#22c55e" />
        <span className="whitespace-nowrap">글로벌 캠퍼스 네트워크</span>
      </span>
    ),
    description: 'UvA 학생 전용 커뮤니티 연결',
    images: [
      membershipImage('uvain-network-1.webp'),
    ],
  },
]

const SLIDE_INTERVAL_MS = 12000
const IMAGE_INTERVAL_MS = 2600
const BOTTOM_TAB_OFFSET = `calc(${PUBLIC_BOTTOM_TAB_PADDING} + 45px)`

function MembershipCarousel() {
  const navigate = useNavigate()
  const [activeSlide, setActiveSlide] = useState(0)
  const [transitionEnabled, setTransitionEnabled] = useState(true)
  const [imageIndexes, setImageIndexes] = useState(() =>
    MEMBERSHIP_SLIDES.map(() => 0),
  )
  const [loadedImageIndexes, setLoadedImageIndexes] = useState(() =>
    MEMBERSHIP_SLIDES.map(() => []),
  )
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const interactionPausedRef = useRef(false)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)

  const slides = MEMBERSHIP_SLIDES
  const realActiveSlide = activeSlide % slides.length

  const handleImageLoaded = (slideIndex, imageIndex) => {
    setLoadedImageIndexes((current) => {
      if (current[slideIndex]?.includes(imageIndex)) return current

      return current.map((indexes, index) =>
        index === slideIndex ? [...indexes, imageIndex].sort((a, b) => a - b) : indexes,
      )
    })
  }

  const goToSlide = useCallback((nextSlide) => {
    const slideCount = slides.length
    setTransitionEnabled(true)
    setActiveSlide((nextSlide + slideCount) % slideCount)
  }, [slides.length])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!interactionPausedRef.current) goToSlide(activeSlide + 1)
    }, SLIDE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [activeSlide, goToSlide])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (interactionPausedRef.current) return
      setImageIndexes((current) =>
        current.map((imageIndex, slideIndex) => {
          const loadedIndexes = loadedImageIndexes[slideIndex] || []
          if (loadedIndexes.length > 1) {
            const currentLoadedIndex = loadedIndexes.indexOf(imageIndex)
            const nextLoadedIndex =
              currentLoadedIndex >= 0
                ? (currentLoadedIndex + 1) % loadedIndexes.length
                : 0
            return loadedIndexes[nextLoadedIndex]
          }

          return loadedIndexes[0] ?? imageIndex
        }),
      )
    }, IMAGE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [loadedImageIndexes, slides])

  const pauseInteraction = () => {
    interactionPausedRef.current = true
  }

  const resumeInteraction = () => {
    window.setTimeout(() => {
      interactionPausedRef.current = false
    }, 900)
  }

  const handleTouchStart = (e) => {
    pauseInteraction()
    setIsDragging(true)
    touchStartXRef.current = e.touches[0].clientX
    touchStartYRef.current = e.touches[0].clientY
  }

  const handlePointerDown = () => {
    pauseInteraction()
  }

  const handlePointerUp = () => {
    resumeInteraction()
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return

    const deltaX = e.touches[0].clientX - touchStartXRef.current
    const deltaY = e.touches[0].clientY - touchStartYRef.current

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      e.preventDefault()
      setDragOffset(deltaX)
    }
  }

  const handleTouchEnd = () => {
    if (Math.abs(dragOffset) > 56) {
      goToSlide(activeSlide + (dragOffset < 0 ? 1 : -1))
    }

    setDragOffset(0)
    setIsDragging(false)
    resumeInteraction()
  }

  return (
    <div
      className="membership-carousel relative h-full overflow-hidden bg-white text-gray-950 no-highlight-zone dark:bg-[#121212] dark:text-white"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="flex h-full"
        style={{
          width: `${slides.length * 100}%`,
          transform: `translateX(calc(-${activeSlide * (100 / slides.length)}% + ${dragOffset}px))`,
          transition: isDragging || !transitionEnabled
            ? 'none'
            : 'transform 620ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {slides.map((slide, slideIndex) => (
          <MembershipSlide
            key={`${slide.key}-${slideIndex}`}
            slide={slide}
            slideIndex={slideIndex}
            slideCount={slides.length}
            shouldLoadImages={
              slideIndex === realActiveSlide ||
              slideIndex === (realActiveSlide + 1) % slides.length
            }
            imageIndex={imageIndexes[slideIndex]}
            onImageLoaded={handleImageLoaded}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 bg-black/30 dark:bg-black/38" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={{
          height: '58%',
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.84) 58%, #ffffff 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden dark:block"
        style={{
          height: '58%',
          background:
            'linear-gradient(to bottom, rgba(18,18,18,0), rgba(18,18,18,0.84) 58%, #121212 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute left-0 right-0 px-6 text-left"
        style={{
          bottom: `calc(${BOTTOM_TAB_OFFSET} + clamp(46px, 14.4vw, 62px))`,
          zIndex: 20,
        }}
      >
        <h2 className="max-w-sm text-[clamp(18px,6vw,26px)] font-bold leading-tight text-gray-950 dark:text-white">
          {slides[realActiveSlide].title}
        </h2>
        {slides[realActiveSlide].description && (
          <p className="mt-2 max-w-sm text-sm font-medium leading-relaxed text-gray-600 dark:text-gray-300">
            {slides[realActiveSlide].description}
          </p>
        )}
      </div>

      <div
        className="pointer-events-none absolute left-0 right-0 flex justify-center gap-1.5"
        style={{
          bottom: `calc(${BOTTOM_TAB_OFFSET} + clamp(18px, 5.6vw, 24px))`,
          zIndex: 25,
        }}
      >
        {slides.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            aria-label={`Go to membership slide ${index + 1}`}
            onClick={() => goToSlide(index)}
            className="pointer-events-auto rounded-full transition-all"
            style={{
              width: index === realActiveSlide ? 8 : 6,
              height: index === realActiveSlide ? 8 : 6,
              background:
                index === realActiveSlide
                  ? 'var(--membership-dot-active)'
                  : 'var(--membership-dot-idle)',
            }}
          />
        ))}
      </div>

      <div
        className="absolute left-0 right-0 px-5"
        style={{
          bottom: `calc(${BOTTOM_TAB_OFFSET} - 42px)`,
          zIndex: 30,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mx-auto block w-full max-w-sm rounded-full bg-orange-500 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
        >
          로그인
        </button>
      </div>
    </div>
  )
}

function MembershipSlide({
  slide,
  slideIndex,
  slideCount,
  shouldLoadImages,
  imageIndex,
  onImageLoaded,
}) {
  return (
    <section
      className="relative h-full flex-shrink-0 overflow-hidden bg-neutral-400 dark:bg-neutral-700"
      style={{ width: `${100 / slideCount}%` }}
    >
      {shouldLoadImages && slide.images.map((image, index) => (
        <MembershipImageLayer
          key={image.src || index}
          image={image}
          active={index === imageIndex}
          slideIndex={slideIndex}
          imageIndex={index}
          onImageLoaded={onImageLoaded}
        />
      ))}

    </section>
  )
}

function MembershipImageLayer({
  image,
  active,
  slideIndex,
  imageIndex,
  onImageLoaded,
}) {
  const src = image.src

  if (!src && !image.style) return null

  if (!src) {
    return (
      <div
        className="absolute inset-0 bg-neutral-400 transition-opacity duration-1000 ease-out dark:bg-neutral-700"
        style={{
          ...image.style,
          opacity: active ? 1 : 0,
        }}
      >
        <div className="absolute inset-x-8 top-[16%] grid grid-cols-2 gap-3 opacity-80">
          <div className="h-40 rounded-[8px] bg-white/18 backdrop-blur-[1px]" />
          <div className="mt-10 h-52 rounded-[8px] bg-black/12 backdrop-blur-[1px]" />
          <div className="h-36 rounded-[8px] bg-black/14 backdrop-blur-[1px]" />
          <div className="h-32 rounded-[8px] bg-white/20 backdrop-blur-[1px]" />
        </div>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-out"
      style={{ opacity: active ? 1 : 0 }}
      onLoad={() => {
        onImageLoaded(slideIndex, imageIndex)
      }}
    />
  )
}

// eslint-disable-next-line no-unused-vars
function MembershipTab() {
  const navigate = useNavigate()
  return (
    <div className="h-full overflow-y-auto flex items-center justify-center bg-white no-highlight-zone">
      <div
        className="py-8"
        style={{ width: 'calc(100% - 32px)', maxWidth: '368px' }}
      >
        <div className="membership-heading text-center mb-8">
          <h2 className="mb-2 text-3xl font-bold text-gray-900">완벽한 캠퍼스 라이프를 위한 시작</h2>
          <p className="text-sm font-normal leading-relaxed text-gray-400">
            UvA-IN Membership
          </p>
          <p className="text-gray-500 text-sm leading-relaxed">UvA-IN Membership</p>
        </div>

        <div className="space-y-3 mb-8">
          <Benefit icon={<ForkKnife size={24} weight="fill" color="#f97316" />} title="로컬 맛집 & 카페 제휴 할인">
            암스테르담 곳곳의 제휴 매장 혜택
          </Benefit>
          <Benefit icon={<Calendar size={24} weight="fill" color="#3b82f6" />} title="캠퍼스 이벤트 참가비 할인">
            UvA-IN 독점 이벤트 지원 혜택
          </Benefit>
          <Benefit icon={<Users size={24} weight="fill" color="#22c55e" />} title="글로벌 캠퍼스 네트워크">
            UvA 학생 전용 커뮤니티 연결
          </Benefit>
        </div>

        <button
          onClick={() => navigate('/login')}
          className="mb-3 w-full rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600"
        >
          로그인
        </button>

        <button
          type="button"
          onClick={() => navigate('/report-content')}
          className="block w-full text-center text-xs text-gray-500 underline underline-offset-2"
        >
          콘텐츠 신고
        </button>

        <button
  onClick={() => navigate('/register')}
  style={{ display: 'none' }}
  className="
    w-full
    font-semibold
    py-3
    rounded-full
    transition-colors
    bg-gray-200 text-gray-900 hover:bg-gray-300
    dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700
  "
>
  회원가입
</button>
      </div>
    </div>
  )
}

function Benefit({ icon, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="font-semibold text-gray-900 text-sm">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{children}</p>
      </div>
    </div>
  )
}
