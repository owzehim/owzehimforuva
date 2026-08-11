import { useEffect, useState, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import MapView from '../components/MapView'
import { SpotCard, RichText } from '../components/SpotCard'
import { MAP_CATEGORIES, CATEGORY_ICONS_WHITE, CATEGORY_ICONS_ORANGE, CATEGORY_ICONS_BLACK } from '../lib/mapCategories'
import { getVisibleMapCategories } from '../lib/mapCategoryVisibility'
import { QrCode, Calendar, Clock, MapPin, NavigationArrow, Door, InstagramLogo, Gear, UserCircle, List, ArrowsVertical, SortAscending, SortDescending, CaretRight, CaretDoubleRight, CaretLeft, ArrowRight, CheckCircle, HandPointing, SealWarning } from '@phosphor-icons/react'
import { useReviewPrompt } from '../hooks/useReviewPrompt'
import ReviewModal from '../components/ReviewModal'
import ActivityStatsCard from '../components/ActivityStatsCard'
import QRScanner from '../components/QRScanner'
import StampCardMini from '../features/stampCard/components/StampCardMini'
import StampCardModal from '../features/stampCard/components/StampCardModal'
import { primeStoreReviewSummaries } from '../hooks/useStoreReviewSummary'
import LoadingIndicator from '../components/LoadingIndicator'

const MEMBER_ACTIVE_TAB_KEY = 'uvain_member_active_tab'
const MEMBER_TABS = ['qr', 'events', 'map']
const MEMBER_EVENT_LIST_OPEN_KEY = 'uvain_member_event_list_open'
const MEMBER_BOTTOM_TAB_PADDING = 42
const REOPEN_WELCOME_SLIDES_KEY = 'uvain_reopen_welcome_slides'

function getStoredMemberTab() {
  if (typeof window === 'undefined') return 'qr'
  const storedTab = window.sessionStorage.getItem(MEMBER_ACTIVE_TAB_KEY)
  return MEMBER_TABS.includes(storedTab) ? storedTab : 'qr'
}

function getStoredEventListOpen() {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(MEMBER_EVENT_LIST_OPEN_KEY) === '1'
}

export default function MemberPage() {
  const [authUserId, setAuthUserId] = useState(null)
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState(getStoredMemberTab)
  const [tabKey, setTabKey] = useState(0)
  const [events, setEvents] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [qrCardLifted, setQrCardLifted] = useState(false)
  const [welcomeSlidesOpen, setWelcomeSlidesOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const scannerOpenSignal = location.state?.reopenQrScanner || 0
  const reopenWelcomeSlides =
    location.state?.reopenWelcomeSlides === true ||
    window.sessionStorage.getItem(REOPEN_WELCOME_SLIDES_KEY) === '1'

  // Review prompt hook
  const {
    open: reviewOpen,
    storeName,
    rating,
    tags,
    comment,
    errors,
    submitError,
    submitting,
    selectRating,
    toggleTag,
    setComment,
    submitReview,
    skipReview,
  } = useReviewPrompt()

  // Load user, member, events, restaurants
  useEffect(() => {
    const fetchData = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('auth.getUser error:', userError)
        setLoading(false)
        return
      }

      // Admin flag from user metadata (same logic as App.jsx)
      const isAdminUser = user?.user_metadata?.role === 'admin'
      setAuthUserId(user.id)

      // Members: maybeSingle() so we don't get a 406 if the admin has no row
      const { data: memberData, error: memberError } = await supabase
        .from('members')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (memberError) {
        console.warn(
          'members error (can be normal if no row):',
          memberError.message,
        )
      }

      setMember(memberData || null)
      setIsAdmin(isAdminUser)
      const shouldShowWelcomeSlides =
        reopenWelcomeSlides ||
        (Boolean(memberData) && !memberData.tutorial_completed_at)

      if (reopenWelcomeSlides) {
        window.sessionStorage.removeItem(REOPEN_WELCOME_SLIDES_KEY)
      }
      setWelcomeSlidesOpen(shouldShowWelcomeSlides)
      // Render the member shell as soon as identity/profile data is available.
      // Events and spots can load in the background instead of blocking startup.
      setLoading(false)

      const [eventResult, restaurantResult] = await Promise.all([
        supabase.from('events').select('*').order('event_date', { ascending: true }),
        supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
      ])

      if (eventResult.error) {
        console.error('events error:', eventResult.error.message)
      }
      if (restaurantResult.error) {
        console.error('restaurants error:', restaurantResult.error.message)
      }

      const loadedRestaurants = restaurantResult.data || []
      setEvents(eventResult.data || [])
      setRestaurants(loadedRestaurants)

      // Review summaries are an enhancement for the spot detail view, not a prerequisite
      // for entering the app. Warm their cache after the main screen is already visible.
      void primeStoreReviewSummaries(
        loadedRestaurants.map((restaurant) => restaurant.partnership_id),
      ).catch((error) => {
        console.warn('Failed to pre-load store review summaries:', error)
      })
    }

    fetchData()
  }, [])

  // Prevent iOS edge-swipe back gesture
  useEffect(() => {
    const handler = (e) => {
      if (e.touches.length === 1 && e.touches[0]?.clientX < 30) e.preventDefault()
    }
    document.addEventListener('touchstart', handler, { passive: false })
    return () => document.removeEventListener('touchstart', handler)
  }, [])

  const handleTabChange = (key) => {
    window.sessionStorage.setItem(MEMBER_ACTIVE_TAB_KEY, key)
    setActiveTab(key)
    setTabKey((prev) => prev + 1)
    if (key !== 'qr') {
      setQrCardLifted(false)
    }
  }

  const handleWelcomeSlidesFinish = async () => {
    const completedAt = new Date().toISOString()
    setWelcomeSlidesOpen(false)
    if (!member?.user_id) return

    const { error } = await supabase
      .from('members')
      .update({ tutorial_completed_at: completedAt })
      .eq('user_id', member.user_id)

    if (error) {
      console.warn('Failed to save tutorial completion:', error.message)
      return
    }

    setMember((current) =>
      current ? { ...current, tutorial_completed_at: completedAt } : current,
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#121212]">
        <LoadingIndicator />
      </div>
    )
  }

  const isValid =
    member?.is_member &&
    member?.membership_valid_until &&
    new Date(member.membership_valid_until) >= new Date()

  return (
    <div
      className="member-app-shell relative flex flex-col bg-white overflow-hidden dark:bg-[#121212]"
      style={{ height: '100dvh' }}
    >
      {/* Review modal */}
      <ReviewModal
        open={reviewOpen}
        storeName={storeName}
        rating={rating}
        tags={tags}
        comment={comment}
        errors={errors}
        submitError={submitError}
        submitting={submitting}
        onSelectRating={selectRating}
        onToggleTag={toggleTag}
        onCommentChange={setComment}
        onSubmit={submitReview}
        onSkip={skipReview}
      />

      {welcomeSlidesOpen && (
        <WelcomeSlides
          member={member}
          onFinish={handleWelcomeSlidesFinish}
          onBack={reopenWelcomeSlides ? () => navigate('/settings') : undefined}
        />
      )}

      {/* Header: only on EVENTS tab */}
      {activeTab === 'events' && (
  <div
    className="relative bg-white flex items-center justify-between flex-shrink-0 dark:bg-[#121212]"
    style={{
      paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
      minHeight: 'calc(env(safe-area-inset-top) + 56px)',
    }}
  >
    <div className="w-[60px]" />
    <div className="flex gap-2 items-center">
      {isAdmin && (
        <button
          onClick={() => {
            window.location.href = '/admin'
          }}
          className="fixed flex items-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
          style={{
            right: '66px',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            height: '44px',
            zIndex: 70,
          }}
        >
          관리자
        </button>
      )}
      <button
        onClick={() => navigate('/settings')}
        className="fixed flex h-11 w-11 items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 dark:text-gray-400 dark:hover:bg-gray-800"
        aria-label="Settings"
        style={{
          right: '14px',
          top: 'calc(env(safe-area-inset-top) + 6px)',
          zIndex: 70,
        }}
      >
        {/* CHANGED: size={20} → size={22} to match the MY tab gear icon */}
        <Gear size={22} weight="bold" />
      </button>
    </div>
  </div>
)}

            {/* Floating admin + settings buttons for MY tab (no header) */}
      {activeTab === 'qr' && (
        <div
          className={
            'fixed flex items-center gap-2 transition-opacity duration-200 ' +
            (qrCardLifted ? 'opacity-0 pointer-events-none' : 'opacity-100')
          }
          style={{
            right: '14px',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            zIndex: 70,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {isAdmin && (
            <button
              onClick={() => {
                window.location.href = '/admin'
              }}
              className="flex items-center rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
              style={{
                height: '44px',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              관리자
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="flex h-11 w-11 items-center justify-center text-gray-500 dark:text-gray-300"
            aria-label="Settings"
            style={{
              background: 'transparent',
              boxShadow: 'none',
              borderRadius: 0,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Gear size={22} weight="bold" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div key={tabKey} className="h-full">
          {activeTab === 'qr' && (
            <QRTab
              member={member}
              isValid={isValid}
              scannerOpenSignal={scannerOpenSignal}
              onLiftChange={(lifted) => setQrCardLifted(lifted)}
            />
          )}
          {activeTab === 'events' && <EventsTab events={events} />}
          {activeTab === 'map' && (
  <MapTab
    restaurants={restaurants}
    member={member}
    isValid={isValid}
    isAdmin={isAdmin}
    authUserId={authUserId}
  />
)}        </div>
      </div>

      {/* Bottom tab bar */}
{!welcomeSlidesOpen && (
  <div
    className="bg-white flex flex-shrink-0 dark:bg-[#121212]"
  style={{
    paddingBottom: MEMBER_BOTTOM_TAB_PADDING,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    position: 'relative',
    zIndex: 1030,         // masks the map button (zIndex: 1020) as it slides from behind
  }}
>
        {[
          { key: 'qr', label: 'MY', icon: QrCode },
          { key: 'events', label: 'EVENTS', icon: Calendar },
          { key: 'map', label: 'SPOT', icon: MapPin },
        ].map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={
                'flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors select-none ' +
                (active ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500')
              }
              style={{
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Icon size={20} weight={active ? 'fill' : 'regular'} />
              {tab.label}
            </button>
          )
         })}
      </div>
      )}
    </div>
  )
}

function WelcomeSlides({ member, onFinish, onBack }) {
  const [index, setIndex] = useState(0)
  const [closing, setClosing] = useState(false)
  const [benefitsAcknowledged, setBenefitsAcknowledged] = useState(false)
  const [benefitsAcknowledgementVisible, setBenefitsAcknowledgementVisible] = useState(false)
  const tourLayout = {
    contentTopOffset: '-30px',
    animationTextGap: '20px',
    controlsBottomOffset: '90px',
  }
  const firstName = member?.first_name_korean || member?.first_name_ko || member?.first_name || ''
  const slides = [
    {
      eyebrow: '환영합니다',
      title: firstName ? `${firstName}님, UvA-IN에 오신 것을 환영합니다!` : 'UvA-IN에 오신 것을 환영합니다',
      body: 'UvA-IN 멤버 전용 혜택과 이벤트를 한곳에서 빠르게 만나보세요.',
      icon: UserCircle,
    },
    {
      eyebrow: 'MY tab',
      title: '앱 내 멤버십 카드로 Check-IN 하세요',
      body: '멤버십 카드로 매장 QR코드를 스캔해 Check-IN 하면 멤버십 혜택이 적용됩니다.',
      icon: QrCode,
      demo: 'membership-card',
    },
    {
      eyebrow: 'EVENTS tab',
      title: '다가오는 UvA-IN 이벤트를 확인하세요',
      body: '좌우로 밀어 이벤트를 둘러보고 위로 올려 상세 정보를 확인하세요.',
      icon: Calendar,
      demo: 'events',
    },
    {
      eyebrow: 'SPOT tab',
      title: 'UvA-IN 제휴 매장을 둘러보세요',
      body: '지도 위 UvA-IN 제휴 매장 마커를 누르고 위로 올려 매장 정보와 우술랭 평가를 확인하세요.',
      icon: MapPin,
      demo: 'spot',
    },
    {
      eyebrow: 'Membership Check-IN',
      title: 'Check-IN 유의사항',
      titleIcon: SealWarning,
      bodyNode: (
        <>
          제휴 매장 안에서 QR코드를 스캔 후{' '}
          <strong className="font-black text-gray-950 dark:text-white">Check-IN 완료 화면과 학생증</strong>
          을 직원에게 꼭 보여주세요.
        </>
      ),
      icon: CheckCircle,
      demo: 'benefits',
    },
  ]
  const slide = slides[index]
  const Icon = slide.icon
  const TitleIcon = slide.titleIcon
  const isLast = index === slides.length - 1
  useEffect(() => {
    setBenefitsAcknowledgementVisible(false)
    if (!isLast) return undefined

    const timer = window.setTimeout(() => setBenefitsAcknowledgementVisible(true), 5000)
    return () => window.clearTimeout(timer)
  }, [isLast])

  const finishTour = () => {
    setClosing(true)
    window.setTimeout(onFinish, 260)
  }

  return (
    <div
      className={
        'fixed inset-0 z-[120] flex select-none flex-col bg-white text-gray-950 transition-opacity duration-300 dark:bg-[#121212] dark:text-white ' +
        (closing ? 'opacity-0' : 'opacity-100')
      }
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 18px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div className="h-10 px-6">
        {(onBack || index > 0) && (
          <button
            type="button"
            onClick={() => {
              if (index === 0) {
                onBack?.()
                return
              }
              setIndex((value) => Math.max(0, value - 1))
            }}
            className="absolute left-[14px] z-10 flex h-11 w-11 items-center justify-center text-[#374151] dark:text-[#c7c7cc]"
            style={{ top: 'calc(env(safe-area-inset-top) + 6px)' }}
            aria-label={index === 0 ? 'Back to settings' : 'Previous slide'}
          >
            <CaretLeft size={24} weight="bold" />
          </button>
        )}
      </div>

      <div
        className="flex flex-1 flex-col justify-center px-8"
      >
        <div
          key={index}
          className="mx-auto flex w-full max-w-sm flex-col items-start"
          style={{
            animation: 'welcomeSlideIn 220ms ease-out',
            transform: `translateY(${tourLayout.contentTopOffset})`,
          }}
        >
          {slide.demo === 'membership-card' ? (
            <MembershipCardTourDemo bottomGap={tourLayout.animationTextGap} />
          ) : slide.demo === 'events' ? (
            <EventsTourDemo bottomGap={tourLayout.animationTextGap} />
          ) : slide.demo === 'spot' ? (
            <SpotTourDemo bottomGap={tourLayout.animationTextGap} />
          ) : slide.demo === 'benefits' ? (
            <BenefitsTourDemo bottomGap={tourLayout.animationTextGap} />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full bg-orange-50 text-orange-500 dark:bg-orange-500/10"
              style={{ marginBottom: tourLayout.animationTextGap }}
            >
              <Icon size={48} weight="fill" />
            </div>
          )}
          <p className="mb-3 text-xs font-black tracking-[0.22em] text-orange-500">
            {slide.eyebrow}
          </p>
          <h1 className="text-[34px] font-black leading-tight tracking-normal">
            {TitleIcon && <TitleIcon size={30} weight="bold" className="mr-2 inline-block align-[-0.1em] text-gray-950 dark:text-white" />}
            {slide.title}
          </h1>
          <p className="mt-5 text-base font-medium leading-7 text-gray-500 dark:text-gray-300">
            {slide.bodyNode || slide.body}
          </p>
        </div>
      </div>

      <div className="px-8" style={{ paddingBottom: tourLayout.controlsBottomOffset }}>
        {isLast && (
          <label
            className={
              'mx-auto mb-4 flex max-w-sm items-center justify-center gap-2 text-sm font-bold text-gray-600 transition-opacity duration-500 dark:text-gray-300 ' +
              (benefitsAcknowledgementVisible ? 'opacity-100' : 'pointer-events-none opacity-0')
            }
          >
            <input
              type="checkbox"
              checked={benefitsAcknowledged}
              onChange={(event) => setBenefitsAcknowledged(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-orange-500"
            />
            이해했습니다
          </label>
        )}
        <div className="mx-auto flex max-w-sm flex-col gap-5">
          <div className="flex items-center justify-center gap-1.5">
            {slides.map((_, dotIndex) => (
              <span
                key={dotIndex}
                className={
                  'rounded-full transition-all duration-200 ' +
                  (dotIndex === index
                    ? 'h-2 w-2 bg-orange-500'
                    : 'h-1.5 w-1.5 bg-gray-200 dark:bg-gray-700')
                }
              />
            ))}
          </div>
          <button
            type="button"
            disabled={isLast && !benefitsAcknowledged}
            onClick={() => {
              if (isLast) {
                if (!benefitsAcknowledged) return
                finishTour()
                return
              }
              setIndex((value) => value + 1)
            }}
            className={
              'flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50 ' +
              (isLast && !benefitsAcknowledged
                ? 'cursor-not-allowed'
                : 'active:bg-orange-600')
            }
          >
            {isLast ? '시작하기' : '다음'}
            {isLast ? <CheckCircle size={19} weight="bold" /> : <ArrowRight size={19} weight="bold" />}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes welcomeSlideIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes tourCardFlip {
          0%, 30% { transform: rotateY(0deg); }
          42%, 84% { transform: rotateY(180deg); }
          100% { transform: rotateY(0deg); }
        }
        @keyframes tourHandTap {
          0%, 10% { opacity: 0; transform: translate(110px, 8px) rotate(-18deg) scale(1); }
          18%, 25% { opacity: 1; transform: translate(72px, 42px) rotate(-18deg) scale(1); }
          30%, 34% { opacity: 1; transform: translate(58px, 52px) rotate(-18deg) scale(0.9); }
          40%, 78% { opacity: 0; transform: translate(88px, 68px) rotate(-12deg) scale(0.9); }
          88%, 100% { opacity: 0; transform: translate(132px, 92px) rotate(-10deg) scale(0.9); }
        }
        @keyframes tourScanLine {
          0%, 42% { opacity: 0; transform: translateY(-58px); }
          48% { opacity: 1; transform: translateY(-58px); }
          62% { opacity: 1; transform: translateY(58px); }
          68%, 100% { opacity: 0; transform: translateY(58px); }
        }
        @keyframes tourTapPulse {
          0%, 27% { opacity: 0; transform: scale(0.3); }
          32% { opacity: 0.45; transform: scale(1); }
          43%, 100% { opacity: 0; transform: scale(1.8); }
        }
        @keyframes eventSheetReveal {
          0%, 39.5% { transform: translateY(180px); }
          53.5%, 61.83% { transform: translateY(0); }
          75.83%, 100% { transform: translateY(180px); }
        }
        @keyframes eventHandGesture {
          0%, 6% { opacity: 0; transform: translate(128px, 132px) rotate(-16deg) scale(1); }
          10% { opacity: 1; transform: translate(104px, 132px) rotate(-16deg) scale(1); }
          21.7% { opacity: 1; transform: translate(36px, 132px) rotate(-16deg) scale(0.9); }
          26.9%, 35% { opacity: 0; transform: translate(28px, 132px) rotate(-16deg) scale(0.9); }
          35.1% { opacity: 0; transform: translate(92px, 260px) rotate(-10deg) scale(1); }
          37%, 39.5% { opacity: 1; transform: translate(92px, 260px) rotate(-10deg) scale(1); }
          53.5%, 61.83% { opacity: 1; transform: translate(92px, 124px) rotate(-10deg) scale(0.9); }
          75.83% { opacity: 1; transform: translate(92px, 260px) rotate(-10deg) scale(0.9); }
          77.83%, 100% { opacity: 0; transform: translate(92px, 260px) rotate(-10deg) scale(0.9); }
        }
        @keyframes eventInfoA {
          0%, 15% { opacity: 1; transform: translateX(0); }
          21.5%, 77.83% { opacity: 0; transform: translateX(-14px); }
          77.84% { opacity: 0; transform: translateX(0); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes eventInfoB {
          0%, 15% { opacity: 0; transform: translateX(14px); }
          22.8%, 77.83% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(0); }
        }
        @keyframes spotMarkerPulse {
          0%, 18% { opacity: 0; transform: scale(0.35); }
          24% { opacity: 0.55; transform: scale(1); }
          34%, 100% { opacity: 0; transform: scale(2.1); }
        }
        @keyframes spotCardReveal {
          0%, 20% { opacity: 0; transform: translateY(290px); }
          30%, 55% { opacity: 1; transform: translateY(180px); }
          69%, 77.33% { opacity: 1; transform: translateY(0); }
          91.33% { opacity: 1; transform: translateY(180px); }
          100% { opacity: 0; transform: translateY(180px); }
        }
        @keyframes spotCardShape {
          0%, 55% { border-radius: 20px 20px 0 0; }
          69%, 77.33% { border-radius: 0; }
          91.33%, 100% { border-radius: 20px 20px 0 0; }
        }
        @keyframes spotHandGesture {
          0%, 10% { opacity: 0; transform: translate(16px, 104px) rotate(-14deg) scale(1); }
          18% { opacity: 1; transform: translate(-10px, 130px) rotate(-14deg) scale(1); }
          25%, 30% { opacity: 1; transform: translate(-24px, 142px) rotate(-14deg) scale(0.9); }
          35.2% { opacity: 0; transform: translate(-24px, 142px) rotate(-14deg) scale(0.9); }
          46.67% { opacity: 0; transform: translate(92px, 260px) rotate(-10deg) scale(1); }
          55% { opacity: 1; transform: translate(92px, 260px) rotate(-10deg) scale(1); }
          69%, 77.33% { opacity: 1; transform: translate(92px, 124px) rotate(-10deg) scale(0.9); }
          91.33% { opacity: 1; transform: translate(92px, 260px) rotate(-10deg) scale(0.9); }
          93.33%, 100% { opacity: 0; transform: translate(92px, 260px) rotate(-10deg) scale(0.9); }
        }
        @keyframes benefitScannerFade {
          0%, 42% { opacity: 1; transform: scale(1); }
          54%, 100% { opacity: 0; transform: scale(0.98); }
        }
        @keyframes benefitScanLine {
          0%, 14% { opacity: 0; transform: translateY(-45px); }
          20% { opacity: 1; transform: translateY(-45px); }
          34% { opacity: 1; transform: translateY(45px); }
          42%, 100% { opacity: 0; transform: translateY(45px); }
        }
        @keyframes benefitSuccessPop {
          0%, 48% { opacity: 0; transform: translateY(10px) scale(0.96); }
          62%, 100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes benefitBottomTab {
          0%, 42% { opacity: 1; }
          48%, 100% { opacity: 0; }
        }
        @keyframes benefitStudentId {
          0%, 72% { opacity: 0; transform: translate(20px, 14px) rotate(4deg) scale(0.92); }
          82%, 100% { opacity: 1; transform: translate(0, 0) rotate(-2deg) scale(1); }
        }
        @keyframes benefitStepOne {
          0%, 62% { opacity: 0; transform: scale(0.6); }
          70%, 100% { opacity: 1; transform: scale(1); }
        }
        @keyframes benefitStepTwo {
          0%, 84% { opacity: 0; transform: scale(0.6); }
          92%, 100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

function MembershipCardTourDemo({ bottomGap = '32px' }) {
  const miniCardTop = '58px'
  const scannerFrameTop = '88px'
  const scannerFrameSize = '116px'
  const scannerCornerSize = '38px'
  const animationDuration = '4.2s'

  return (
    <div className="relative h-[360px] w-full max-w-sm" style={{ marginBottom: bottomGap }}>
      <div className="absolute left-1/2 top-0 h-[348px] w-[190px] -translate-x-1/2 overflow-hidden rounded-[24px] border border-gray-200 bg-white dark:border-[#2c2c2e] dark:bg-[#121212]">
        <Gear size={20} weight="bold" className="absolute right-5 top-[17px] text-gray-500 dark:text-gray-400" />
        <div
          className="absolute left-1/2 h-[300px] w-[190px]"
          style={{
            top: miniCardTop,
            transform: 'translateX(-50%) scale(0.78)',
            transformOrigin: 'top center',
            perspective: '700px',
          }}
        >
        <div
          className="relative h-full w-full"
          style={{
            animation: `tourCardFlip ${animationDuration} ease-in-out infinite`,
            transformStyle: 'preserve-3d',
          }}
        >
          <div
            className="absolute inset-0 rounded-[12px] border border-[#d6d3c0] bg-[#F6F4F1] p-2.5 dark:border-[#2c2c2e] dark:bg-[#1c1c1e]"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3a0] dark:bg-orange-500/20">
                <UserCircle size={38} weight="fill" className="text-[#8a8461] dark:text-gray-400" />
              </div>
              <div className="mt-2.5 flex flex-col items-end gap-1.5">
                <span className="h-1 w-24 rounded-full bg-[#2c2a27] dark:bg-white" />
                <span className="h-1 w-20 rounded-full bg-[#9a9992] dark:bg-gray-500" />
                <span className="h-1 w-14 rounded-full bg-orange-500" />
              </div>
            </div>

            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: scannerFrameTop,
                width: scannerFrameSize,
                height: scannerFrameSize,
              }}
            >
              {[
                'left-0 top-0 border-l-2 border-t-2 rounded-tl',
                'right-0 top-0 border-r-2 border-t-2 rounded-tr',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br',
              ].map((classes) => (
                <span
                  key={classes}
                  className={`absolute border-[#b9b8b3] dark:border-gray-600 ${classes}`}
                  style={{
                    width: scannerCornerSize,
                    height: scannerCornerSize,
                  }}
                />
              ))}
              <QrCode
                size={40}
                weight="bold"
                className="absolute left-1/2 top-1/2 text-[#c9c8c3] dark:text-gray-600"
                style={{ transform: 'translate(-50%, -50%)' }}
              />
            </div>

            <div
              className="absolute bottom-7 left-2 right-2 text-center text-[36px] leading-none text-[#2c2a27] dark:text-[#A1A1AA]"
              style={{ fontFamily: '"Alien Block", "Arial Black", Impact, sans-serif' }}
            >
              UvA-IN
            </div>
          </div>

          <div
            className="absolute inset-0 rounded-[12px] border border-[#d6d3c0] bg-[#F6F4F1] dark:border-[#2c2c2e] dark:bg-[#1c1c1e]"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: scannerFrameTop,
                width: scannerFrameSize,
                height: scannerFrameSize,
              }}
            >
              {[
                'left-0 top-0 border-l-2 border-t-2 rounded-tl',
                'right-0 top-0 border-r-2 border-t-2 rounded-tr',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br',
              ].map((classes) => (
                <span
                  key={classes}
                  className={`absolute border-[#b9b8b3] dark:border-gray-600 ${classes}`}
                  style={{
                    width: scannerCornerSize,
                    height: scannerCornerSize,
                  }}
                />
              ))}
              <span
                className="absolute left-0 right-0 top-1/2 h-0.5 rounded-full bg-orange-500"
                style={{ animation: `tourScanLine ${animationDuration} ease-in-out infinite` }}
              />
              <QrCode
                size={40}
                weight="bold"
                className="absolute left-1/2 top-1/2 text-[#c9c8c3] dark:text-gray-600"
                style={{ transform: 'translate(-50%, -50%)' }}
              />
            </div>
          </div>
        </div>
      </div>
        <TourBottomTab activeIndex={0} />
      </div>

      <span
        className="absolute left-1/2 top-[124px] h-16 w-16 rounded-full bg-orange-500/20"
        style={{ animation: `tourTapPulse ${animationDuration} ease-in-out infinite` }}
      />
      <HandPointing
        size={64}
        weight="fill"
        className="absolute left-1/2 top-[140px] text-orange-500 drop-shadow-sm"
        style={{ animation: `tourHandTap ${animationDuration} ease-in-out infinite` }}
      />
    </div>
  )
}

function EventsTourDemo({ bottomGap = '32px' }) {
  // This longer loop leaves a 1.5s pause after the sheet closes before the
  // info resets. Individual transition percentages preserve their prior speeds.
  const animationDuration = '6s'

  return (
    <div className="relative h-[360px] w-full max-w-sm" style={{ marginBottom: bottomGap }}>
      <div className="absolute left-1/2 top-0 h-[348px] w-[190px] -translate-x-1/2 overflow-hidden rounded-[24px] border border-gray-200 bg-white dark:border-[#2c2c2e] dark:bg-[#121212]">
        <List size={20} weight="bold" className="absolute left-5 top-[17px] text-gray-500 dark:text-gray-400" />
        <Gear size={20} weight="bold" className="absolute right-5 top-[17px] text-gray-500 dark:text-gray-400" />

        <div
          className="absolute left-5 right-5 top-16"
          style={{ animation: `eventInfoA ${animationDuration} ease-in-out infinite` }}
        >
          <div className="flex h-[44px] items-end">
            <div className="text-[44px] font-black leading-none text-gray-950 dark:text-white">31</div>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div className="text-[18px] font-black leading-none text-gray-950 dark:text-white">AUGUST</div>
            <div className="text-[18px] font-black leading-none text-orange-500">D-7</div>
          </div>
          <div className="mt-2 h-3 w-28 rounded-full bg-gray-400 dark:bg-gray-500" />
          <div className="mt-3 flex items-center gap-2">
            <Clock size={17} weight="fill" className="text-orange-500" />
            <div className="h-2.5 w-20 rounded-full bg-gray-400 dark:bg-gray-500" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <NavigationArrow size={17} weight="fill" className="text-orange-500" />
            <div className="h-2.5 w-16 rounded-full bg-gray-400 dark:bg-gray-500" />
          </div>
        </div>

        <div
          className="absolute left-5 right-5 top-16"
          style={{ animation: `eventInfoB ${animationDuration} ease-in-out infinite` }}
        >
          <div className="flex h-[44px] items-end">
            <div className="text-[44px] font-black leading-none text-gray-950 dark:text-white">14</div>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div className="text-[18px] font-black leading-none text-gray-950 dark:text-white">SEPTEMBER</div>
            <div className="text-[18px] font-black leading-none text-gray-400 dark:text-gray-500">Past</div>
          </div>
          <div className="mt-2 h-3 w-24 rounded-full bg-gray-400 dark:bg-gray-500" />
          <div className="mt-3 flex items-center gap-2">
            <Clock size={17} weight="fill" className="text-orange-500" />
            <div className="h-2.5 w-16 rounded-full bg-gray-400 dark:bg-gray-500" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <NavigationArrow size={17} weight="fill" className="text-orange-500" />
            <div className="h-2.5 w-20 rounded-full bg-gray-400 dark:bg-gray-500" />
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 h-[290px] rounded-t-[20px] bg-white px-5 pt-4 dark:bg-[#1c1c1e]"
          style={{ animation: `eventSheetReveal ${animationDuration} ease-in-out infinite` }}
        >
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="relative aspect-square w-full overflow-hidden rounded-[12px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1c1c1e]">
            <div className="absolute left-5 top-5 h-14 w-14 rounded-full bg-orange-500/80" />
            <div className="absolute right-4 top-8 h-20 w-10 rounded-full bg-[#c5b3ff]/80" />
            <div className="absolute bottom-5 left-4 h-12 w-24 rounded-[18px] bg-gray-200 dark:bg-gray-700" />
            <div className="absolute bottom-8 right-5 h-9 w-9 rotate-45 rounded-[8px] bg-[#8fd3ff]/80" />
          </div>
          <div className="mt-4 h-3 w-28 rounded-full bg-gray-900 dark:bg-white" />
          <div className="mt-3 h-2 w-full rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="mt-2 h-2 w-32 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="mt-2 h-2 w-24 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="mt-5 h-9 w-28 rounded-full bg-gray-950 dark:bg-white" />
        </div>
        <TourBottomTab activeIndex={1} />
      </div>
      <HandPointing
        size={64}
        weight="fill"
        className="absolute left-1/2 top-0 text-orange-500 drop-shadow-sm"
        style={{ animation: `eventHandGesture ${animationDuration} ease-in-out infinite` }}
      />
    </div>
  )
}

function SpotTourDemo({ bottomGap = '32px' }) {
  const animationDuration = '6s'
  const categories = [0, 1, 2, 3]

  return (
    <div className="relative h-[360px] w-full max-w-sm" style={{ marginBottom: bottomGap }}>
      <div className="absolute left-1/2 top-0 h-[348px] w-[190px] -translate-x-1/2 overflow-hidden rounded-[24px] border border-gray-200 bg-[#eef2ef] dark:border-[#2c2c2e] dark:bg-[#121212]">
        <div className="absolute left-0 right-0 top-0 z-[5] flex h-[54px] items-center gap-1.5 overflow-hidden bg-white px-3 dark:bg-[#121212]">
          {categories.map((category, index) => (
            <span
              key={category}
              className={
                'flex h-6 w-10 shrink-0 self-center items-center justify-start rounded-full pl-2 ' +
                (index === 0
                  ? 'bg-orange-500'
                  : 'bg-gray-100 dark:bg-[#2c2c2e]')
              }
            >
              <span className={'h-2 w-2 rounded-full ' + (index === 0 ? 'bg-white' : 'bg-orange-500')} />
            </span>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 top-[54px] overflow-hidden bg-[#ebe9e2] dark:bg-[#2b3131]">
          <div className="absolute -left-14 top-[-34px] h-[360px] w-10 rotate-[18deg] bg-[#9bd4f4] dark:bg-[#347b9f]" />
          <div className="absolute -left-12 top-[98px] h-14 w-[250px] rotate-[18deg] bg-white dark:bg-[#dbe5e4]" />
          <div className="absolute left-[70px] top-[-30px] h-[340px] w-10 rotate-[26deg] bg-white dark:bg-[#dbe5e4]" />

        </div>

        <div className="absolute left-[72px] top-[126px] z-[2]">
          <span
            className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500/20"
            style={{ animation: `spotMarkerPulse ${animationDuration} ease-in-out infinite` }}
          />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm">
            <MapPin size={28} weight="fill" />
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 z-[3] h-[294px] rounded-t-[20px] bg-white px-5 pt-4 dark:bg-[#1c1c1e]"
          style={{
            animation: `spotCardReveal ${animationDuration} ease-in-out infinite, spotCardShape ${animationDuration} ease-in-out infinite`,
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-36 rounded-full bg-gray-950 dark:bg-white" />
          <div className="mt-3 flex items-center gap-1">
            {[0, 1, 2, 3, 4].map((ratingDot) => (
              <span key={ratingDot} className="h-2.5 w-2.5 rounded-full bg-orange-500" />
            ))}
            <span className="ml-1 text-[12px] font-black leading-none text-orange-500">5.0</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="aspect-square rounded-[10px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1c1c1e]">
              <div className="m-3 h-10 rounded-full bg-[#835c3f]/50" />
              <div className="mx-5 h-8 rounded-full bg-[#f97316]/60" />
            </div>
            <div className="aspect-square rounded-[10px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1c1c1e]">
              <div className="m-4 h-12 rounded-full bg-[#f97316]/70" />
              <div className="mx-7 h-5 rounded-full bg-[#3d2a1d]/50" />
            </div>
          </div>
          <div className="mt-5 h-12 rounded-[18px] rounded-bl-sm bg-orange-500 px-5 py-5">
            <div className="mx-auto h-2.5 w-20 rounded-full bg-white" />
          </div>
        </div>
        <TourBottomTab activeIndex={2} />
      </div>
      <HandPointing
        size={64}
        weight="fill"
        className="absolute left-1/2 top-0 text-orange-500 drop-shadow-sm"
        style={{ animation: `spotHandGesture ${animationDuration} ease-in-out infinite` }}
      />
    </div>
  )
}

function BenefitsTourDemo({ bottomGap = '32px' }) {
  const animationDuration = '4.2s'
  const scannerFrameTop = '60px'
  const scannerFrameSize = '90px'
  const scannerCornerSize = '30px'

  return (
    <div className="relative h-[360px] w-full max-w-sm" style={{ marginBottom: bottomGap }}>
      <div className="absolute left-1/2 top-0 h-[348px] w-[190px] -translate-x-1/2 overflow-hidden rounded-[24px] border border-gray-200 bg-white dark:border-[#2c2c2e] dark:bg-[#121212]">
        <div
          className="absolute inset-0 bg-white px-5 py-8 dark:bg-[#121212]"
          style={{ animation: `benefitScannerFade ${animationDuration} ease-in-out forwards` }}
        >
          <Gear size={20} weight="bold" className="absolute right-5 top-[17px] text-gray-500 dark:text-gray-400" />
          <div className="absolute left-1/2 top-[58px] h-[232px] w-[148px] -translate-x-1/2 rounded-[10px] border border-[#d6d3c0] bg-[#F6F4F1] dark:border-[#2c2c2e] dark:bg-[#1c1c1e]">
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{ top: scannerFrameTop, width: scannerFrameSize, height: scannerFrameSize }}
            >
              {[
                'left-0 top-0 border-l-2 border-t-2 rounded-tl',
                'right-0 top-0 border-r-2 border-t-2 rounded-tr',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br',
              ].map((classes) => (
                <span
                  key={classes}
                  className={`absolute border-gray-400 dark:border-gray-500 ${classes}`}
                  style={{ width: scannerCornerSize, height: scannerCornerSize }}
                />
              ))}
              <QrCode
                size={40}
                weight="bold"
                className="absolute left-1/2 top-1/2 text-gray-300 dark:text-gray-600"
                style={{ transform: 'translate(-50%, -50%)' }}
              />
              <span
                className="absolute left-0 right-0 top-1/2 h-0.5 rounded-full bg-orange-500"
                style={{ animation: `benefitScanLine ${animationDuration} ease-in-out forwards` }}
              />
            </div>
          </div>
        </div>

        <div
          className="absolute inset-0 bg-white px-5 pt-9 dark:bg-[#121212]"
          style={{ animation: `benefitSuccessPop ${animationDuration} ease-in-out forwards` }}
        >
          <div
            className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-sm font-black text-white shadow-sm"
            style={{ animation: `benefitStepOne ${animationDuration} ease-out forwards` }}
          >
            1
          </div>
          <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle size={30} weight="bold" />
              </div>
              <div className="mx-auto mt-4 h-3.5 w-28 rounded-full bg-gray-950 dark:bg-white" />
              <div className="mx-auto mt-3 h-2 w-24 rounded-full bg-gray-400 dark:bg-gray-600" />
              <div className="mx-auto mt-5 h-2.5 w-32 rounded-full bg-orange-500" />
              <div className="mt-5 rounded-[12px] border-2 border-orange-500 px-3 py-3">
                {[52, 62, 48, 58].map((width, index) => (
                  <div
                    key={index}
                    className={'flex items-center justify-between ' + (index > 0 ? 'mt-3 border-t border-gray-100 pt-3 dark:border-gray-800' : '')}
                  >
                    <div className="h-2 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-700" />
                    <div className="h-2 shrink-0 rounded-full bg-gray-950 dark:bg-white" style={{ width }} />
                  </div>
                ))}
              </div>
          </div>
        </div>
        <TourBottomTab activeIndex={0} lift={7} style={{ animation: `benefitBottomTab ${animationDuration} ease-in-out forwards` }} />
      </div>

      <div
        className="absolute bottom-[28px] right-[62px] h-[61px] w-[96px] rounded-[9px] border-2 border-orange-500 bg-white p-2.5 shadow-sm dark:bg-[#1c1c1e]"
        style={{ animation: `benefitStudentId ${animationDuration} ease-in-out forwards` }}
      >
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="flex-1">
            <div className="h-1.5 w-10 rounded-full bg-gray-950 dark:bg-white" />
            <div className="mt-1.5 h-1.5 w-7 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-300 dark:bg-gray-600" />
      </div>
      <div
        className="absolute bottom-[66px] right-[48px] flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-sm font-black text-white shadow-sm"
        style={{ animation: `benefitStepTwo ${animationDuration} ease-out forwards` }}
      >
        2
      </div>
    </div>
  )
}

function TourBottomTab({ activeIndex, style, lift = 5 }) {
  const tabs = [QrCode, Calendar, MapPin]

  return (
    <div
      aria-hidden="true"
      className="absolute bottom-0 left-0 right-0 z-10 flex h-10 items-center justify-between bg-white px-6 dark:bg-[#121212]"
      style={style}
    >
      {tabs.map((TabIcon, index) => (
        <TabIcon
          key={index}
          size={15}
          weight={index === activeIndex ? 'fill' : 'regular'}
          className={index === activeIndex ? 'text-orange-500' : 'text-gray-300 dark:text-gray-600'}
          style={{ transform: `translateY(-${lift}px)` }}
        />
      ))}
    </div>
  )
}
// Pastel avatar colors
const PASTEL_COLORS = [
  '#FFB3B3',
  '#FFD9A0',
  '#FFF3A0',
  '#B3F0C2',
  '#A8D8FF',
  '#C5B3FF',
  '#FFB3E6',
  '#B3F0EE',
]

function getPastelColor(seed) {
  const str = seed || 'default'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length]
}

// Membership Card
function MembershipCard({
  member,
  isValid,
  onQRScanned,
  disabled = false,
  onFlipChange,
  darkMode = false,
  scannerOpenSignal = 0,
}) {
  const [flipped, setFlipped] = useState(false)

  const W = 'min(calc(100vw - 32px), 398px)'
  const cardW = W
  const cardH = `calc(${W} * 1.586)`
  const fs = {
    brand: `calc(${W} * 0.038)`,
    valid: `calc(${W} * 0.032)`,
    name: `calc(${W} * 0.052)`,
    wordmark: `calc(${W} * 0.18)`,
  }
  const cardLayout = {
    membershipToValidGap: `calc(${W} * 0.022)`,
    validToNameGap: `calc(${W} * 0.018)`,
  }
  const cardTextTop = {
    membership: 0,
    valid: `calc(${W} * 0.046 + ${cardLayout.membershipToValidGap})`,
    name: `calc(${W} * 0.084 + ${cardLayout.membershipToValidGap} + ${cardLayout.validToNameGap})`,
  }

  const avatarSeed = `${member?.first_name || ''}${member?.last_name || ''}`
  const pastelBg = getPastelColor(avatarSeed)
  const englishDisplayName = [member?.first_name, member?.last_name]
    .map((namePart) => namePart?.trim())
    .filter(Boolean)
    .join(' ')
  const avatarSize = `calc(${W} * 0.21)`
  const hasProfileImage = !!member?.profile_image_url
  // Keep the membership-card guide identical to QRScanner's real 220px scan box.
  const qrOutlineSize = '220px'
  const BRACKET = 28
  const BRACKET_STROKE = 3
  const cardBg = darkMode ? '#1C1C1E' : '#F6F4F1'
  const cardBorder = darkMode ? '#2C2C2E' : '#d6d3c0'
  const cardShadow = darkMode
    ? '0 18px 38px rgba(0,0,0,0.34)'
    : '0 14px 35px rgba(15,23,42,0.09)'
  const primaryText = darkMode ? '#F7F8F9' : '#2C2A27'
  const secondaryText = darkMode ? '#A1A1AA' : '#6b6a5e'
  const mutedText = darkMode ? '#6F6F76' : 'rgba(44,42,39,0.4)'
  const faintText = darkMode ? '#5F5F66' : 'rgba(44,42,39,0.25)'
  const scannerLine = darkMode ? '#8E8E93' : 'rgba(44,42,39,0.3)'
  const avatarIconColor = 'rgba(44,42,39,0.55)'

  useEffect(() => {
    if (onFlipChange) onFlipChange(flipped)
  }, [flipped, onFlipChange])

  useEffect(() => {
    if (scannerOpenSignal) setFlipped(true)
  }, [scannerOpenSignal])

  const cardFront = (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '16px',
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: cardShadow,
        padding: `calc(${W} * 0.07)`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* TOP */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          height: avatarSize,
        }}
      >
        <div
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            background: hasProfileImage ? 'transparent' : pastelBg,
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          {hasProfileImage ? (
            <img
              src={member.profile_image_url}
              alt="Profile"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <UserCircle
              size="72%"
              weight="fill"
              color={avatarIconColor}
            />
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: `calc(100% - ${avatarSize} - ${W} * 0.04)`,
            height: avatarSize,
            textAlign: 'right',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: cardTextTop.membership,
              right: 0,
              fontFamily: 'var(--font-app)',
              fontSize: fs.brand,
              fontWeight: 700,
              color: primaryText,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            UvA-IN Membership
          </span>
          <span
            style={{
              position: 'absolute',
              top: cardTextTop.valid,
              right: 0,
              fontFamily: 'var(--font-app)',
              fontSize: fs.valid,
              fontWeight: 500,
              color: secondaryText,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Valid Until{' '}
            {member?.membership_valid_until
              ? new Date(
                  member.membership_valid_until,
                ).toLocaleDateString('en-CA')
              : 'N/A'}
          </span>
          <span
            style={{
              position: 'absolute',
              top: cardTextTop.name,
              right: 0,
              fontFamily: 'var(--font-app)',
              fontSize: fs.name,
              fontWeight: 800,
              color: '#f97316',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {englishDisplayName}
          </span>
        </div>
      </div>

      {/* MIDDLE */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: '52px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: qrOutlineSize,
            height: qrOutlineSize,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: BRACKET,
              height: BRACKET,
              borderTop: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderLeft: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRadius: '4px 0 0 0',
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: BRACKET,
              height: BRACKET,
              borderTop: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRight: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRadius: '0 4px 0 0',
            }}
          />
          <span
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: BRACKET,
              height: BRACKET,
              borderBottom: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderLeft: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRadius: '0 0 0 4px',
            }}
          />
          <span
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: BRACKET,
              height: BRACKET,
              borderBottom: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRight: `${BRACKET_STROKE}px solid ${scannerLine}`,
              borderRadius: '0 0 4px 0',
            }}
          />

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: `calc(${W} * 0.02)`,
            }}
          >
            <QrCode
              size={`calc(${W} * 0.1)`}
              weight="bold"
              color={faintText}
            />
            <span
              style={{
                fontFamily: 'var(--font-app)',
                fontSize: `calc(${W} * 0.034)`,
                fontWeight: 600,
                color: mutedText,
                letterSpacing: '0.05em',
              }}
            >
              눌러서 Check-IN 하기
            </span>
          </div>
        </div>
      </div>

      {/* BOTTOM */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span
          style={{
            fontFamily: '"Alien Block", "Arial Black", Impact, sans-serif',
            fontSize: fs.wordmark,
            fontWeight: 900,
            color: darkMode ? '#A1A1AA' : '#2C2A27',
            letterSpacing: '-0.01em',
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          UvA-IN
        </span>
      </div>
    </div>
  )

  if (!isValid) {
    return (
      <div
        style={{
          width: cardW,
          height: cardH,
          margin: '0 auto',
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            padding: '12px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '16px',
              border: `2px dotted ${cardBorder}`,
              background: cardBg,
              boxShadow: 'none',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: darkMode ? '#F7F8F9' : '#4b5563',
              textAlign: 'center',
              padding: '16px',
              fontFamily: 'var(--font-app)',
            }}
          >
            <span style={{ fontSize: fs.valid, fontWeight: 500 }}>
              활성화된 멤버십이 없습니다
            </span>
            <span
              style={{
                marginTop: '10px',
                fontSize: `calc(${W} * 0.028)`,
                color: darkMode ? '#6F6F76' : '#9ca3af',
              }}
            >
              멤버십 갱신은 임원에게 문의해주세요
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: cardW,
        height: cardH,
        margin: '0 auto',
        perspective: '1200px',
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onClick={() => {
        if (disabled || !isValid) return
        setFlipped((f) => !f)
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front face */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            padding: '12px',
            boxSizing: 'border-box',
            zIndex: 1,
          }}
        >
          {cardFront}
        </div>

        {/* Back face (camera) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            padding: '12px',
            boxSizing: 'border-box',
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: cardBg,
              border: `1px solid ${cardBorder}`,
              borderRadius: '16px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {flipped && <QRScanner onScan={onQRScanned} darkMode={darkMode} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// QR Tab
function QRTab({ member, isValid, scannerOpenSignal = 0, onLiftChange }) {
  const navigate = useNavigate()
  const [lifted, setLifted] = useState(false)
  const [cardLiftOffset, setCardLiftOffset] = useState(0)
  const [isCardDragging, setIsCardDragging] = useState(false)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  const cardLayerRef = useRef(null)
  const activityRef = useRef(null)
  const touchStartY = useRef(null)
  const liftedRef = useRef(false)
  const W = 'min(calc(100vw - 32px), 398px)'
  const cardRestingOffsetPx = 0
  const liftedActivityGapPx = 0
  const cardRestingOffsetY = `${cardRestingOffsetPx}px`
  const inactiveCardRestingOffsetY = `${cardRestingOffsetPx}px`
  const guideTextGapY = '2px' // Increase for more space between the card and guide text.
  const fs = {
    guide: `calc(${W} * 0.032)`,
  }

  const getMaxLift = () =>
    (activityRef.current?.offsetHeight ?? 260) + cardRestingOffsetPx + liftedActivityGapPx

  const handleTouchStart = (e) => {
    if (cardFlipped) return
    touchStartY.current = e.touches[0].clientY
    setIsCardDragging(true)
  }

  const handleTouchMove = (e) => {
    if (cardFlipped) return
    if (touchStartY.current == null) return
    const dy = touchStartY.current - e.touches[0].clientY
    if (Math.abs(dy) > 10) {
      e.preventDefault()
    }
  }

  const handleTouchEnd = (e) => {
    if (cardFlipped) return
    if (touchStartY.current == null) return
    const dy = touchStartY.current - e.changedTouches[0].clientY
    const max = getMaxLift()
    const SWIPE_THRESHOLD = 40
    let nextLifted = liftedRef.current

    if (dy > SWIPE_THRESHOLD) {
      nextLifted = true
    } else if (dy < -SWIPE_THRESHOLD) {
      nextLifted = false
    }

    setCardLiftOffset(nextLifted ? max : 0)
    liftedRef.current = nextLifted
    setLifted(nextLifted)
    setIsCardDragging(false)
    touchStartY.current = null
  }

  useEffect(() => {
    setCardLiftOffset(lifted ? getMaxLift() : 0)
    if (onLiftChange) onLiftChange(lifted)
  }, [lifted, onLiftChange])

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

  useEffect(() => {
    if (!scannerOpenSignal) return
    setLifted(false)
    liftedRef.current = false
    if (onLiftChange) onLiftChange(false)
  }, [scannerOpenSignal, onLiftChange])

  const handleQRScanned = (rawValue) => {
    setLifted(false)
    liftedRef.current = false
    if (onLiftChange) onLiftChange(false)
    navigate('/scan', { state: { rawValue, returnToMemberScanner: true } })
  }

  if (!isValid) {
    if (onLiftChange) onLiftChange(false)
    return (
      <div
        className="no-highlight-zone"
        style={{
          position: 'relative',
          height: '100%',
          overflow: 'hidden',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: darkMode ? '#121212' : '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 16px',
            transform: `translate3d(0, ${inactiveCardRestingOffsetY}, 0)`,
          }}
        >
          <div style={{ width: W }}>
            <MembershipCard member={member} isValid={false} darkMode={darkMode} />
          </div>
        </div>
      </div>
    )
  }

  // Scanning state
  return (
    <div
      className="no-highlight-zone"
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Recent activity + long fade when lifted */}
      <div
        ref={activityRef}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '0 16px 16px',
          zIndex: 1,
        }}
      >
        {isValid && (
          <div className="relative">
            <ActivityStatsCard userId={member?.user_id} />
          </div>
        )}
      </div>

      {/* Membership card layer */}
      <div
        ref={cardLayerRef}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          top: 0,
          backgroundColor: darkMode ? '#121212' : '#ffffff',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 16px',
          transform: `translate3d(0, calc(${cardRestingOffsetY} - ${cardLiftOffset}px), 0)`,
          transition: isCardDragging
            ? 'none'
            : 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          willChange: 'transform',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: W,
          }}
        >
          <MembershipCard
            member={member}
            isValid={isValid}
            onQRScanned={handleQRScanned}
            disabled={lifted}
            onFlipChange={setCardFlipped}
            darkMode={darkMode}
            scannerOpenSignal={scannerOpenSignal}
          />
          <div
            style={{
              position: 'absolute',
              top: `calc(100% + ${guideTextGapY})`,
              left: 0,
              right: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              paddingRight: '20px',
              gap: 4,
            }}
          >
            {!cardFlipped && (
              <span
                style={{
                  fontSize: fs.guide,
                  lineHeight: 1,
                  color: darkMode ? '#FAFAFA' : 'rgba(44,42,39,0.35)',
                  fontWeight: 500,
                  transition: 'color 0.25s ease',
                }}
              >
                {lifted
                   ? '내려서 Check-IN 하기'
                   : '위로 올려서 최근 활동 보기'}
              </span>
            )}
            {cardFlipped && (
              <span
                style={{
                  fontSize: fs.guide,
                  lineHeight: 1,
                  color: darkMode ? '#FAFAFA' : 'rgba(44,42,39,0.35)',
                  fontWeight: 500,
                }}
              >
                 눌러서 돌아가기
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top fade → soften the safe-area/card line when lifted */}
      {lifted && (
        <div
          className="pointer-events-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 24,
            background:
              darkMode
                ? 'linear-gradient(to bottom, rgba(18,18,18,1), rgba(18,18,18,0))'
                : 'linear-gradient(to bottom, rgba(255,255,255,1), rgba(255,255,255,0))',
            zIndex: 30,
          }}
        />
      )}
    </div>
  )
}

// Nav Button (not currently used, but kept for future)
function NavBtn({ onClick, children, style = {} }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(30,30,30,0.7)',
        border: 'none',
        color: '#fff',
        borderRadius: '999px',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        lineHeight: 1,
        cursor: 'pointer',
        backdropFilter: 'blur(4px)',
        transition: 'background 0.15s',
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = 'rgba(30,30,30,0.92)')
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = 'rgba(30,30,30,0.7)')
      }
    >
      {children}
    </button>
  )
}

// Event Lightbox (SpotCard-style)
function EventLightbox({ imgs, startIndex = 0, onClose, onIndexChange }) {
  const [index, setIndex] = useState(startIndex)
  const [visible, setVisible] = useState(false)
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const lightboxDotsBottom = 'calc(env(safe-area-inset-bottom) + 10px)'

  const goToIndex = (nextIndex) => {
    const clampedIndex = Math.max(0, Math.min(nextIndex, imgs.length - 1))
    if (clampedIndex === index) return
    setIndex(clampedIndex)
    onIndexChange?.(clampedIndex)
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
    setIndex(startIndex)
  }, [startIndex, imgs])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight') goToIndex(index + 1)
      if (e.key === 'ArrowLeft') goToIndex(index - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgs.length, index])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => onClose?.(), 250)
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

  if (!imgs || imgs.length === 0) return null

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
        className="no-highlight-zone"
        onClick={handleClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
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
          <div
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
                    decoding="async"
                    fetchPriority={imgIndex === index ? 'high' : 'auto'}
                    loading={Math.abs(imgIndex - index) <= 1 ? 'eager' : 'lazy'}
                    alt={`사진 ${imgIndex + 1}`}
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
                  background:
                    i === index ? '#fff' : 'rgba(255,255,255,0.4)',
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

// Events Tab
function EventsTab({ events }) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const toLocalDateKey = (value) => {
    if (!value) return ''
    const s = String(value)
    if (s.includes('T') || s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s)) {
      const d = new Date(s)
      if (!Number.isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          '0',
        )}-${String(d.getDate()).padStart(2, '0')}`
      }
    }
    return s.slice(0, 10)
  }

  const parseLocalDate = (value) => {
    if (!value) return new Date(NaN)
    const key = toLocalDateKey(value)
    const [year, month, day] = key.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  const getEventDates = (ev) => {
    if (!ev) return []
    const dates = Array.isArray(ev.event_dates) ? ev.event_dates : []
    const allDates = [...dates, ev.event_date].filter(Boolean)
    const unique = Array.from(new Set(allDates.map((date) => toLocalDateKey(date))))
    return unique.length ? unique : []
  }

  const getPrimaryEventDate = (ev) => getEventDates(ev)[0] || ev?.event_date
  const getPrimaryEventDateTime = (ev) => {
    const dates = Array.isArray(ev?.event_dates) ? ev.event_dates : []
    return dates[0] || ev?.event_date
  }

  // Split & sort
  const datedEvents = events.filter((ev) => getPrimaryEventDate(ev))

  const tbdEvents = events
    .filter((ev) => !getPrimaryEventDate(ev))
    .sort((a, b) =>
      a.created_at && b.created_at
        ? new Date(a.created_at) - new Date(b.created_at)
        : 0,
    )

  const futureEvents = datedEvents
    .filter((ev) => new Date(getPrimaryEventDateTime(ev)) >= now)
    .sort((a, b) => new Date(getPrimaryEventDateTime(a)) - new Date(getPrimaryEventDateTime(b)))

  const pastEvents = datedEvents
    .filter((ev) => new Date(getPrimaryEventDateTime(ev)) < now)
    .sort((a, b) => new Date(getPrimaryEventDateTime(b)) - new Date(getPrimaryEventDateTime(a)))

  const nextEvent = futureEvents[0] || null
  const otherUpcomingEvents = nextEvent ? futureEvents.slice(1) : futureEvents
  const eventTabEvents = [...futureEvents.slice().reverse(), ...pastEvents, ...tbdEvents]
  const allEvents = eventTabEvents
  const initialEvent = nextEvent || allEvents[0] || null

  const [selectedEvent, setSelectedEvent] = useState(initialEvent)
  const [previewEvent, setPreviewEvent] = useState(initialEvent)
  const [isDragging, setIsDragging] = useState(false)
  const [isTouching, setIsTouching] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [slideIndexes, setSlideIndexes] = useState({})
  const [eventListOpen, setEventListOpen] = useState(getStoredEventListOpen)
  const [eventListClosing, setEventListClosing] = useState(false)
  const [eventListNewestFirst, setEventListNewestFirst] = useState(true)
  const [eventCardOpen, setEventCardOpen] = useState(false)
  const [eventSwipeDirection, setEventSwipeDirection] = useState(0)
  const [loadedEventPreviewImages, setLoadedEventPreviewImages] = useState({})
  const [eventPreviewFadingToFirst, setEventPreviewFadingToFirst] = useState(false)
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  // SpotCard-style Lightbox index
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const [imageAspectRatios, setImageAspectRatios] = useState({})
  const [frontPanelTextColor, setFrontPanelTextColor] = useState('#1f2937')
  const [calMonth, setCalMonth] = useState(() => {
    const base = getPrimaryEventDate(initialEvent)
      ? parseLocalDate(getPrimaryEventDate(initialEvent))
      : now
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const containerRef = useRef(null)
  const eventSwipeStartX = useRef(null)
  const eventSwipeStartY = useRef(null)
  const eventCardStartY = useRef(null)
  const eventCardScrollRef = useRef(null)
  const eventPreviewTouchStartX = useRef(null)
  const eventPreviewTouchStartY = useRef(null)
  const eventPreviewSuppressClick = useRef(false)

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

  useEffect(() => {
    if (!initialEvent) return
    const selectedStillExists = selectedEvent && allEvents.some((ev) => ev.id === selectedEvent.id)
    if (selectedStillExists) return
    setSelectedEvent(initialEvent)
    setPreviewEvent(initialEvent)
  }, [initialEvent, selectedEvent, allEvents])

  useEffect(() => {
    const selectedDate = getPrimaryEventDate(selectedEvent)
    if (!selectedDate) return
    const d = parseLocalDate(selectedDate)
    setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [selectedEvent])

  const setSlide = (id, idx) =>
    setSlideIndexes((p) => ({
      ...p,
      [id]: idx,
    }))

  const markEventPreviewImageLoaded = (url) => {
    window.setTimeout(() => {
      setLoadedEventPreviewImages((prev) => ({
        ...prev,
        [url]: true,
      }))
    }, 350)
  }

  const closeEventCard = (eventId = selectedEventRef.current?.id) => {
    const shouldFadeToFirst = eventId && (slideIndexes[eventId] || 0) !== 0

    if (shouldFadeToFirst) {
      setEventPreviewFadingToFirst(true)
      window.setTimeout(() => {
        setSlide(eventId, 0)
      }, 140)
    }

    setEventCardOpen(false)

    if (shouldFadeToFirst) {
      window.setTimeout(() => {
        setEventPreviewFadingToFirst(false)
      }, 360)
    }
  }

  useEffect(() => {
    if (!selectedEvent?.id) return
    setSlide(selectedEvent.id, 0)
  }, [selectedEvent?.id])

  // Load image dimensions to detect aspect ratio
  useEffect(() => {
    const loadImageDimensions = (url) =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          const ratio = img.width / img.height
          resolve(ratio)
        }
        img.onerror = () => resolve(1)
        img.src = url
      })

    const loadAllRatios = async () => {
      const ratios = {}
      for (const ev of events) {
        const imgs = ev.image_urls || []
        const evRatios = []
        for (const url of imgs) {
          const ratio = await loadImageDimensions(url)
          evRatios.push(ratio)
        }
        ratios[ev.id] = evRatios
      }
      setImageAspectRatios(ratios)
    }

    loadAllRatios()
  }, [events])

  const isPortrait = (aspectRatio) =>
    aspectRatio >= 0.75 && aspectRatio <= 0.85

  // Keyboard nav for image slider in expanded cards
  useEffect(() => {
    if (!expandedId) return
    const ev = events.find((e) => e.id === expandedId)
    if (!ev) return
    const imgs = ev.image_urls || []
    if (imgs.length <= 1) return

    const h = (e) => {
      if (e.key === 'ArrowRight') {
        setSlide(
          expandedId,
          Math.min((slideIndexes[expandedId] || 0) + 1, imgs.length - 1),
        )
      } else if (e.key === 'ArrowLeft') {
        setSlide(expandedId, Math.max((slideIndexes[expandedId] || 0) - 1, 0))
      }
    }

    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [expandedId, slideIndexes, events])

  // Vertical drag between events in header
  const pointerStartY = useRef(null)
  const dragBaseIdxRef = useRef(0)
  const currentDragIdxRef = useRef(0)
  const activePointerIdRef = useRef(null)
  const allEventsRef = useRef(allEvents)
  const selectedEventRef = useRef(selectedEvent)

  const currentEventIndex = allEvents.findIndex(
    (ev) => ev.id === selectedEvent?.id,
  )
  const activeEventIndex = currentEventIndex >= 0
    ? currentEventIndex
    : Math.max(0, allEvents.findIndex((ev) => ev.id === initialEvent?.id))
  const scrollProgress = 0

  useEffect(() => {
    allEventsRef.current = allEvents
    selectedEventRef.current = selectedEvent
  }, [allEvents, selectedEvent])

  useEffect(() => {
    if (typeof Image === 'undefined' || !allEvents.length) return

    const nearbyImageUrls = [
      activeEventIndex - 2,
      activeEventIndex - 1,
      activeEventIndex,
      activeEventIndex + 1,
      activeEventIndex + 2,
    ]
      .flatMap((idx) => allEvents[idx]?.image_urls?.slice(0, 2) || [])
      .filter(Boolean)

    Array.from(new Set(nearbyImageUrls)).forEach((url) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
    })
  }, [allEvents, activeEventIndex])

  const resetDragState = () => {
    pointerStartY.current = null
    dragBaseIdxRef.current = activeEventIndex
    currentDragIdxRef.current = activeEventIndex
    activePointerIdRef.current = null
    setIsDragging(false)
    setIsTouching(false)
    setPreviewEvent(selectedEventRef.current)
  }

  const finalizeDrag = () => {
    if (pointerStartY.current == null) return
    resetDragState()
  }

  const updateDraggedEvent = (clientY) => {
    if (pointerStartY.current == null) return
    const eventsNow = allEventsRef.current
    if (!eventsNow.length) return

    const dy = pointerStartY.current - clientY
    const delta =
      dy > 0 ? Math.floor(dy / 60) : dy < 0 ? Math.ceil(dy / 60) : 0
    const idx = Math.max(
      0,
      Math.min(dragBaseIdxRef.current + delta, eventsNow.length - 1),
    )

    if (idx === currentDragIdxRef.current) return

    currentDragIdxRef.current = idx
    const nextEvent = eventsNow[idx]
    selectedEventRef.current = nextEvent
    setSelectedEvent(nextEvent)
    setPreviewEvent(nextEvent)
  }

  const handleContainerPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0) return
    if (e.target.closest('button, a, input, textarea, select')) return

    const rect = containerRef.current?.getBoundingClientRect()
    // Avoid grabbing when finger starts too low (near calendar)
    if (rect && e.clientY > rect.bottom - 60) return

    activePointerIdRef.current = e.pointerId
    pointerStartY.current = e.clientY
    dragBaseIdxRef.current = activeEventIndex
    currentDragIdxRef.current = activeEventIndex
    setIsDragging(false)
    setIsTouching(true)
    setPreviewEvent(selectedEventRef.current)

    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handleContainerPointerMove = (e) => {
    if (e.pointerId !== activePointerIdRef.current) return
    updateDraggedEvent(e.clientY)
  }

  const handleContainerPointerEnd = (e) => {
    if (e.pointerId !== activePointerIdRef.current) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    finalizeDrag()
  }

  const handleContainerPointerCancel = (e) => {
    if (e.pointerId !== activePointerIdRef.current) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    finalizeDrag()
  }

  // Helper to open lightbox at specific index
  const openLightboxAt = (index) => {
    setLightboxIndex(index)
  }

  const handleEventPreviewTouchStart = (e) => {
    if (!eventCardOpen) return
    e.stopPropagation()
    eventPreviewTouchStartX.current = e.touches[0].clientX
    eventPreviewTouchStartY.current = e.touches[0].clientY
  }

  const handleEventPreviewTouchEnd = (e) => {
    if (!eventCardOpen) return
    e.stopPropagation()
    if (eventPreviewTouchStartX.current == null || eventPreviewTouchStartY.current == null) return
    if (!displayEvent) return

    const dx = e.changedTouches[0].clientX - eventPreviewTouchStartX.current
    const dy = e.changedTouches[0].clientY - eventPreviewTouchStartY.current
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    const currentSlide = slideIndexes[displayEvent.id] || 0

    if (dy > 42 && absDy > absDx * 1.1) {
      eventPreviewSuppressClick.current = true
      closeEventCard(displayEvent.id)
    } else if (displayImages.length > 1 && absDx > absDy && absDx > 40) {
      e.stopPropagation()
      eventPreviewSuppressClick.current = true
      if (dx < 0) {
        setSlide(displayEvent.id, Math.min(currentSlide + 1, displayImages.length - 1))
      } else {
        setSlide(displayEvent.id, Math.max(currentSlide - 1, 0))
      }
    }

    eventPreviewTouchStartX.current = null
    eventPreviewTouchStartY.current = null
  }

  // Formatting helpers
  const getDayDiff = (s) => {
    const d = parseLocalDate(s)
    return Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()) - todayStart) /
        86400000,
    )
  }

  const formatTopDate = (dateStr) => {
    if (!dateStr) return null
    const date = parseLocalDate(dateStr)
    return {
      dayName: date
        .toLocaleDateString('en-US', { weekday: 'short' })
        .replace('.', ''),
      dateNum: String(date.getDate()).padStart(2, '0'),
      monthName: date
        .toLocaleDateString('en-US', { month: 'long' })
        .toUpperCase(),
      year: date.getFullYear(),
    }
  }

  const formatTopTime = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    let h = d.getHours()
    const m = String(d.getMinutes()).padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`
  }

  const formatTimeRange = (ev) => {
    const startDate = getPrimaryEventDateTime(ev)
    if (!startDate) return ''
    const start = new Date(startDate)
    const end = ev.event_end_date ? new Date(ev.event_end_date) : null
    const formatParts = (date) => {
      let h = date.getHours()
      const m = String(date.getMinutes()).padStart(2, '0')
      const ampm = h >= 12 ? 'PM' : 'AM'
      h = h % 12 || 12
      return { time: `${String(h).padStart(2, '0')}:${m}`, ampm }
    }
    const startParts = formatParts(start)
    if (!end || Number.isNaN(end.getTime())) {
      return `${startParts.time} ${startParts.ampm}`
    }
    const endParts = formatParts(end)
    if (startParts.ampm === endParts.ampm) {
      return `${startParts.time} - ${endParts.time} ${endParts.ampm}`
    }
    return `${startParts.time} ${startParts.ampm} - ${endParts.time} ${endParts.ampm}`
  }

  const plainText = (value) => {
    if (!value) return ''
    const el = document.createElement('div')
    el.innerHTML = value
    return (el.textContent || el.innerText || '').trim()
  }

  const getEventStatus = (ev) => {
    if (!ev) return ''
    const eventDate = getPrimaryEventDateTime(ev)
    if (!eventDate) return 'TBD'
    const days = getDayDiff(eventDate)
    if (days < 0) return 'PAST'
    if (nextEvent && ev.id === nextEvent.id)
      return days === 0 ? 'TODAY' : `D-${days}`
    return 'UPCOMING'
  }

  const addToCalendar = (ev) => {
    const startDate = getPrimaryEventDateTime(ev)
    if (!startDate) return
    const start = new Date(startDate)
    const end = ev.event_end_date
      ? new Date(ev.event_end_date)
      : new Date(start.getTime() + 7200000)

    const pad = (n) => String(n).padStart(2, '0')
    const fmt = (d) =>
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      '00Z'

    const ics =
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n` +
      `DTSTART:${fmt(start)}\n` +
      `DTEND:${fmt(end)}\n` +
      `SUMMARY:${ev.title}\n` +
      `LOCATION:${plainText(ev.location)}\n` +
      `DESCRIPTION:\n` +
      `END:VEVENT\nEND:VCALENDAR`

    const url = URL.createObjectURL(
      new Blob([ics], { type: 'text/calendar' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = (ev.title || 'event') + '.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  const openParticipationForm = (ev) => {
    if (!ev?.participation_url || ev?.is_registration_closed) return
    window.open(ev.participation_url, '_blank', 'noopener,noreferrer')
  }

  const W = 'min(calc(100vw - 32px), 398px)'
  const fs = {
    day: `calc(${W} * 0.06)`,
    date: `calc(${W} * 0.24)`,
    month: `calc(${W} * 0.255)`,
    guide: `calc(${W} * 0.032)`, // same as MY tab guide
  }
  // Events hero alignment knobs:
  // - eventHeroThumbSize locks the lightbox square size.
  // - eventDateTopNudge/eventDateBottomNudge tune the visible font edges.
  // - eventDateNumberStretch stretches the number row downward toward the month.
  const eventHeroThumbSize = `calc(${W} * 0.46)`
  const eventDateTopNudge = '-4px'
  const eventDateBottomNudge = '6px'
  const eventDateNumberStretch = 1.35
  const eventDateTop = '1px'
  const eventDetailsTop = '186px'
  const eventCollapsedCardHeight = '260px'
  const eventCardTranslateY = eventCardOpen
    ? '0'
    : `calc(100% - ${eventCollapsedCardHeight})`
  const displayEvent = selectedEvent

  const eventsByDate = {}
  datedEvents.forEach((ev) => {
    getEventDates(ev).forEach((key) => {
      if (!eventsByDate[key]) eventsByDate[key] = []
      eventsByDate[key].push(ev)
    })
  })

  const displayEventDate = getPrimaryEventDate(displayEvent)
  const displayCalMonth = displayEventDate
    ? (() => {
        const d = parseLocalDate(displayEventDate)
        return new Date(d.getFullYear(), d.getMonth(), 1)
      })()
    : calMonth
  const calYear = displayCalMonth.getFullYear()
  const calMonthIdx = displayCalMonth.getMonth()

  const cells = [
    ...Array(new Date(calYear, calMonthIdx, 1).getDay()).fill(null),
    ...Array.from(
      {
        length: new Date(calYear, calMonthIdx + 1, 0).getDate(),
      },
      (_, i) => i + 1,
    ),
  ]
  while (cells.length < 42) cells.push(null)

  const handleDayPress = (day) => {
    if (!day) return
    const key = `${calYear}-${String(calMonthIdx + 1).padStart(
      2,
      '0',
    )}-${String(day).padStart(2, '0')}`
    const dayEvents = eventsByDate[key]
    if (!dayEvents?.length) return
    setSelectedEvent(dayEvents[0])
  }

  const closeEventList = () => {
    window.sessionStorage.removeItem(MEMBER_EVENT_LIST_OPEN_KEY)
    setEventListClosing(true)
    window.setTimeout(() => {
      setEventListOpen(false)
      setEventListClosing(false)
    }, 220)
  }

  const selectEventFromList = (ev) => {
    window.sessionStorage.removeItem(MEMBER_EVENT_LIST_OPEN_KEY)
    setSelectedEvent(ev)
    setPreviewEvent(ev)
    closeEventCard(ev.id)
    setExpandedId(null)
    setLightboxIndex(null)
    setIsDragging(false)
    setIsTouching(false)
    setEventListClosing(true)
    window.setTimeout(() => {
      setEventListOpen(false)
      setEventListClosing(false)
    }, 220)
  }

  const selectAdjacentEvent = (direction) => {
    if (!allEvents.length) return
    const currentIndex = allEvents.findIndex((ev) => ev.id === selectedEvent?.id)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = Math.max(
      0,
      Math.min(baseIndex + direction, allEvents.length - 1),
    )
    if (nextIndex === baseIndex) return
    setEventSwipeDirection(direction)
    setSelectedEvent(allEvents[nextIndex])
    setPreviewEvent(allEvents[nextIndex])
    closeEventCard(allEvents[nextIndex].id)
    window.setTimeout(() => setEventSwipeDirection(0), 320)
  }

  const handleFrameworkTouchStart = (e) => {
    if (eventCardOpen) return
    eventSwipeStartX.current = e.touches[0].clientX
    eventSwipeStartY.current = e.touches[0].clientY
  }

  const handleFrameworkTouchEnd = (e) => {
    if (eventCardOpen) return
    if (eventSwipeStartX.current == null || eventSwipeStartY.current == null) return

    const dx = e.changedTouches[0].clientX - eventSwipeStartX.current
    const dy = e.changedTouches[0].clientY - eventSwipeStartY.current
    eventSwipeStartX.current = null
    eventSwipeStartY.current = null

    if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    selectAdjacentEvent(dx < 0 ? 1 : -1)
  }

  const handleEventCardTouchStart = (e) => {
    eventCardStartY.current = e.touches[0].clientY
  }

  const handleEventCardTouchMove = (e) => {
    if (!eventCardOpen || eventCardStartY.current == null) return

    const dy = e.touches[0].clientY - eventCardStartY.current
    const scrollTop = eventCardScrollRef.current?.scrollTop || 0

    if (dy > 42 && scrollTop <= 0) {
      if (eventCardScrollRef.current) eventCardScrollRef.current.scrollTop = 0
      eventCardStartY.current = null
      closeEventCard()
    }
  }

  const handleEventCardTouchEnd = (e) => {
    if (eventCardStartY.current == null) return
    const dy = e.changedTouches[0].clientY - eventCardStartY.current
    eventCardStartY.current = null

    if (dy < -42) setEventCardOpen(true)
    if (dy > 42) {
      const scrollTop = eventCardScrollRef.current?.scrollTop || 0
      if (!eventCardOpen || scrollTop <= 0) {
        if (eventCardScrollRef.current) eventCardScrollRef.current.scrollTop = 0
        closeEventCard()
      }
    }
  }

  const getListDateParts = (ev) => {
    const date = getPrimaryEventDateTime(ev)
    if (!date) {
      return {
        year: 'TBD',
        month: 'TBD',
        day: '--',
        weekday: 'TBD',
      }
    }

    const d = new Date(date)
    return {
      year: String(d.getFullYear()),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      day: String(d.getDate()),
      weekday: d
        .toLocaleDateString('en-US', { weekday: 'short' })
        .toUpperCase(),
    }
  }

  const getListSortTime = (ev) => {
    const date = getPrimaryEventDateTime(ev)
    return date ? new Date(date).getTime() : Number.POSITIVE_INFINITY
  }

  const sortedListEvents = allEvents.slice().sort((a, b) => {
    const aTime = getListSortTime(a)
    const bTime = getListSortTime(b)
    if (aTime !== bTime) {
      return eventListNewestFirst ? bTime - aTime : aTime - bTime
    }
    return String(a.title || '').localeCompare(String(b.title || ''))
  })

  const groupedListEvents = sortedListEvents.reduce((years, ev) => {
    const parts = getListDateParts(ev)
    let yearGroup = years.find((group) => group.year === parts.year)
    if (!yearGroup) {
      yearGroup = { year: parts.year, months: [] }
      years.push(yearGroup)
    }

    let monthGroup = yearGroup.months.find((group) => group.month === parts.month)
    if (!monthGroup) {
      monthGroup = { month: parts.month, events: [] }
      yearGroup.months.push(monthGroup)
    }

    monthGroup.events.push(ev)
    return years
  }, [])

  const renderEvent = (ev) => {
    if (!ev) return null
    const isExpanded = expandedId === ev.id
    const imgs = ev.image_urls || []
    const instaUrl = ev.instagram_url
    const currentSlide = slideIndexes[ev.id] || 0

    return (
      <div
        key={ev.id}
        className="bg-white rounded-2xl border border-gray-100 overflow-hidden dark:border-[#2c2c2e] dark:bg-[#111111]"
      >
        <button
          onClick={() => setExpandedId(isExpanded ? null : ev.id)}
          className="w-full text-left p-5"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-900 dark:text-white">{ev.title}</p>
            <span className="text-gray-400 text-sm ml-2 dark:text-gray-500">
              {isExpanded ? '-' : '+'}
            </span>
          </div>
          {getPrimaryEventDate(ev) && (
            <div className="flex items-center gap-1.5 text-sm text-orange-500 mt-1">
              <Calendar size={14} weight="fill" />
              <span>
                {new Date(getPrimaryEventDateTime(ev)).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })} {formatTimeRange(ev)}
              </span>
            </div>
          )}
          {ev.location && (
            <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-0.5 dark:text-gray-400">
              <MapPin size={14} weight="fill" />
              <span>{plainText(ev.location)}</span>
            </div>
          )}
        </button>

        {isExpanded && (
          <div>
            {imgs.length > 0 && (
              <div className="px-4">
                <div
                  className="md:hidden"
                  onTouchStart={(e) => {
                    e.currentTarget._sx = e.touches[0].clientX
                  }}
                  onTouchEnd={(e) => {
                    const dx =
                      e.changedTouches[0].clientX - e.currentTarget._sx
                    if (dx < -40 && currentSlide < imgs.length - 1)
                      setSlide(ev.id, currentSlide + 1)
                    else if (dx > 40 && currentSlide > 0)
                      setSlide(ev.id, currentSlide - 1)
                  }}
                >
                  <div
                    className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800"
                    style={{ aspectRatio: '1/1' }}
                  >
                    <div
                      className="flex h-full"
                      style={{
                        transform: `translateX(-${
                          currentSlide * 100
                        }%)`,
                        transition: 'transform 0.3s ease',
                      }}
                    >
                      {imgs.map((url, i) => (
                        <div
                          key={i}
                          className="w-full h-full flex-shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800"
                        >
                          <img
                            src={url}
                            alt=""
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                            }}
                            draggable={false}
                            onClick={() => openLightboxAt(i)}
                          />
                        </div>
                      ))}
                    </div>
                    {imgs.length > 1 && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                        {imgs.map((_, i) => (
                          <div
                            key={i}
                            onClick={() => setSlide(ev.id, i)}
                            className={
                              'rounded-full cursor-pointer ' +
                              (i === currentSlide
                                ? 'bg-white w-2 h-2'
                                : 'bg-white bg-opacity-50 w-1.5 h-1.5')
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="px-5 pb-5">
              {ev.description && (
                <RichText
                  text={ev.description}
                  className="text-sm text-gray-600 mt-3 leading-relaxed block dark:text-gray-300"
                />
              )}
              <div className="flex gap-2 mt-3">
                {getPrimaryEventDate(ev) && (
                  <button
                    onClick={() => addToCalendar(ev)}
                    className="flex-1 text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 dark:bg-gray-800 dark:text-gray-200"
                  >
                    <Calendar size={14} weight="fill" />
                    캘린더에 추가
                  </button>
                )}
                {instaUrl && (
                  <a
                    href={instaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs bg-orange-500 text-white px-3 py-2 rounded-lg text-center flex items-center justify-center gap-1.5"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM5.838 12a6.162 6.162 0 1 1 12.324 0 6.162 6.162 0 0 1-12.324 0zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm4.965-10.322a1.44 1.44 0 1 1 2.881.001 1.44 1.44 0 0 1-2.881-.001z" />
                    </svg>
                    Instagram에서 열기
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // First-panel image + color logic
  const displayImages = displayEvent?.image_urls || []
  const showParticipationButton = displayEvent?.show_participation_button !== false
  const participationWithoutSignup = !!displayEvent?.participation_without_signup
  const canOpenParticipationForm =
    !participationWithoutSignup &&
    !!displayEvent?.participation_url &&
    !displayEvent?.is_registration_closed
  const participationButtonLabel = participationWithoutSignup
    ? '신청 없이 참여'
    : displayEvent?.participation_url
      ? displayEvent.is_registration_closed
        ? '신청 마감'
        : '참여하기'
      : '준비 중'
  const hasImages = displayImages.length > 0
  const displayImageRatios = imageAspectRatios[displayEvent?.id] || []
  const displayImageSlide = displayEvent ? slideIndexes[displayEvent.id] || 0 : 0
  const isCurrentEventImageLoading =
    hasImages && !loadedEventPreviewImages[displayImages[displayImageSlide]]

  useEffect(() => {
    if (!displayEvent || displayImages.length === 0) return
    if (displayImageSlide > displayImages.length - 1) {
      setSlide(displayEvent.id, displayImages.length - 1)
    }
  }, [displayEvent, displayImages.length, displayImageSlide])

  useEffect(() => {
    if (!eventCardOpen && eventCardScrollRef.current) {
      eventCardScrollRef.current.scrollTop = 0
    }
  }, [eventCardOpen, displayEvent?.id])

  const PAST_DATE_COLOR = '#4b5563'
const PAST_DARK_DATE_COLOR = '#BDBDBD'
const DRAG_DATE_COLOR = '#9ca3af'

const isPastSelected =
  getEventStatus(displayEvent) === 'PAST'
const isNextSelected =
  Boolean(nextEvent && displayEvent && displayEvent.id === nextEvent.id)

const baseDateColor = isPastSelected ? PAST_DATE_COLOR : '#1f2937'

const effectiveDateColor = isDragging
  ? DRAG_DATE_COLOR
  : isNextSelected
    ? '#f97316'
  : darkMode && isPastSelected
    ? PAST_DARK_DATE_COLOR
    : darkMode
      ? '#F7F8F9'
      : baseDateColor

  const eventListBg = darkMode ? '#303236' : '#f2f3f5'
  const eventListFade =
    darkMode
      ? 'linear-gradient(180deg, #303236 0%, rgba(48,50,54,0.82) 42%, rgba(48,50,54,0) 100%)'
      : 'linear-gradient(180deg, #f2f3f5 0%, rgba(242,243,245,0.86) 42%, rgba(242,243,245,0) 100%)'
  const eventListIconColor = darkMode ? 'rgba(255,255,255,0.86)' : '#4b5563'
  const eventListYearColor = darkMode ? '#ffffff' : '#111827'
  const eventListCardStyle = darkMode
    ? {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderColor: 'rgba(255,255,255,0.12)',
        color: '#ffffff',
      }
    : {
        backgroundColor: '#fafafa',
        borderColor: '#e5e7eb',
        color: '#111827',
      }
  const eventListMutedColor = darkMode ? 'rgba(255,255,255,0.56)' : '#6b7280'
  const eventListDividerColor = darkMode ? 'rgba(255,255,255,0.12)' : '#e5e7eb'
  const eventListChevronColor = darkMode ? 'rgba(255,255,255,0.76)' : '#111827'

  const getTextColorFromImage = (imageUrl) =>
    new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'Anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const size = 48
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, size, size)

          const imageData = ctx.getImageData(0, 0, size, size).data
          let luminanceTotal = 0
          let samples = 0

          for (let y = 6; y < 34; y += 4) {
            for (let x = 6; x < 42; x += 4) {
              const idx = (y * size + x) * 4
              const r = imageData[idx]
              const g = imageData[idx + 1]
              const b = imageData[idx + 2]
              const srgb = [r, g, b].map((value) => {
                const channel = value / 255
                return channel <= 0.03928
                  ? channel / 12.92
                  : ((channel + 0.055) / 1.055) ** 2.4
              })
              luminanceTotal +=
                0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
              samples += 1
            }
          }

          const avgLuminance = luminanceTotal / Math.max(samples, 1)
          resolve(avgLuminance > 0.42 ? '#111827' : '#ffffff')
        } catch {
          resolve('#111827')
        }
      }
      img.onerror = () => resolve('#111827')
      img.src = imageUrl
    })

  useEffect(() => {
    let cancelled = false
    const update = async () => {
      if (displayImages.length > 0) {
        const color = await getTextColorFromImage(displayImages[0])
        if (!cancelled) setFrontPanelTextColor(color)
      } else {
        if (!cancelled) setFrontPanelTextColor('#111827')
      }
    }
    update()
    return () => {
      cancelled = true
    }
  }, [displayImages])

  const detailImages = displayEvent?.image_urls || []
  const eventDateParts = getPrimaryEventDate(displayEvent)
    ? formatTopDate(getPrimaryEventDate(displayEvent))
    : null

  return (
    <>
      <style>{`
        @keyframes eventContentSlideInFromRight {
          from { opacity: 0; transform: translateX(44px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes eventContentSlideInFromLeft {
          from { opacity: 0; transform: translateX(-44px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes eventPreviewImageSlideInFromRight {
          from { opacity: 0.68; transform: translateX(44px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes eventPreviewImageSlideInFromLeft {
          from { opacity: 0.68; transform: translateX(-44px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes eventImageLoadingShimmer {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }
      `}</style>
      <div
        className="relative h-full overflow-hidden bg-white text-gray-950 no-highlight-zone dark:bg-[#121212] dark:text-white"
        onTouchStart={handleFrameworkTouchStart}
        onTouchEnd={handleFrameworkTouchEnd}
      >
        <button
          type="button"
          onClick={() => {
            setEventListNewestFirst(true)
            window.sessionStorage.setItem(MEMBER_EVENT_LIST_OPEN_KEY, '1')
            setEventListOpen(true)
          }}
          className="fixed flex h-11 w-11 items-center justify-center text-gray-600 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white"
          aria-label="Open event list"
          style={{
            left: '14px',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            zIndex: 70,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <List size={22} weight="bold" />
        </button>

        {displayEvent ? (
          <>
            <div className="absolute inset-0 bg-white dark:bg-[#121212]" />

            {displayEvent.instagram_url && (
              <a
                href={displayEvent.instagram_url}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  'fixed flex h-11 w-11 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm transition-opacity duration-200 active:bg-orange-600 ' +
                  (eventCardOpen ? 'opacity-100' : 'pointer-events-none opacity-0')
                }
                aria-label="Open on Instagram"
                style={{
                  right: '14px',
                  top: 'calc(env(safe-area-inset-top) + 6px)',
                  zIndex: 95,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <InstagramLogo size={22} weight="regular" />
              </a>
            )}

            <div
              className="absolute left-0 right-0 px-6"
              style={{
                top: eventDateTop,
                zIndex: 5,
              }}
            >
              <div
                key={`event-bg-date-${displayEvent.id}`}
                className="mx-auto max-w-md"
                style={{
                  animation:
                    eventSwipeDirection === 0
                      ? 'none'
                      : `${eventSwipeDirection > 0 ? 'eventContentSlideInFromRight' : 'eventContentSlideInFromLeft'} 0.34s cubic-bezier(0.22,1,0.36,1)`,
                }}
              >
                {eventDateParts && (
                  <div
                    className="flex cursor-pointer flex-col items-start"
                    role="button"
                    tabIndex={0}
                    aria-label="Add event to calendar"
                    onClick={() => addToCalendar(displayEvent)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        addToCalendar(displayEvent)
                      }
                    }}
                  >
                    <span
  className="text-[89px] font-medium leading-[0.82] tracking-normal text-gray-950 dark:text-white"
  style={{
    transform: 'scaleY(1.15)',
    transformOrigin: 'top left',
  }}
>
  {eventDateParts.dateNum}
</span>
                    <p className="mt-5 text-[34px] font-semibold leading-none uppercase text-gray-950 dark:text-white">
                      {eventDateParts.monthName}
                    </p>
                    <div className="mt-1 flex w-full items-baseline gap-2">
                      <p className="text-[34px] font-medium leading-none text-gray-700 dark:text-gray-200">
                        {eventDateParts.dayName}
                      </p>
                      <span className="text-[34px] font-medium leading-none text-gray-700 dark:text-gray-200">
                        •
                      </span>
                      <p className="text-[34px] font-medium leading-none text-gray-700 dark:text-gray-200">
                        {eventDateParts.year}
                      </p>
                      <span className="hidden text-[34px] font-medium leading-none text-gray-700 dark:text-gray-200">
                        •
                      </span>
                      <p
                        className={
                          'ml-auto shrink-0 text-right text-[34px] font-medium leading-none ' +
                          (isNextSelected
                            ? 'text-orange-500'
                            : 'text-gray-700 dark:text-gray-200')
                        }
                      >
                        {getEventStatus(displayEvent)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className="absolute left-0 right-0 px-6"
              style={{
                top: eventDetailsTop,
                bottom: eventCardOpen ? '48%' : '250px',
                transition: 'bottom 0.28s ease',
                zIndex: 5,
              }}
            >
              <div
                key={`event-bg-details-${displayEvent.id}`}
                className="mx-auto max-w-md"
                style={{
                  animation:
                    eventSwipeDirection === 0
                      ? 'none'
                      : `${eventSwipeDirection > 0 ? 'eventContentSlideInFromRight' : 'eventContentSlideInFromLeft'} 0.34s cubic-bezier(0.22,1,0.36,1)`,
                }}
              >
                <h1 className="mt-3 text-[34px] font-black leading-tight tracking-normal text-gray-950 dark:text-white">
                  {displayEvent.title || 'Untitled event'}
                </h1>

                <div className="mt-3 space-y-1 text-[13px] font-medium text-gray-700 dark:text-gray-200">
                  {getPrimaryEventDate(displayEvent) && (
                    <div className="flex items-center gap-2">
                      <Clock size={18} weight="fill" color="#f97316" />
                      <span>{formatTimeRange(displayEvent)}</span>
                    </div>
                  )}
                  {displayEvent.location && (
                    <div className="flex items-center gap-2">
                      <NavigationArrow size={18} weight="fill" color="#f97316" />
                      <span>{plainText(displayEvent.location)}</span>
                    </div>
                  )}
                  {displayEvent.location_description && (
                    <div className="flex items-center gap-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      <Door size={18} weight="fill" color="#f97316" />
                      <span>{plainText(displayEvent.location_description)}</span>
                    </div>
                  )}
                  {showParticipationButton && (
                    <button
                      type="button"
                      onClick={() => openParticipationForm(displayEvent)}
                      disabled={!canOpenParticipationForm}
                      className={
                        'mt-5 hidden w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold transition-colors ' +
                        (canOpenParticipationForm
                          ? 'bg-gray-950 text-white active:bg-gray-800 dark:bg-white dark:text-gray-950 dark:active:bg-gray-200'
                          : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500')
                      }
                    >
                      {participationButtonLabel}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {showParticipationButton && (
              <div
                className="absolute left-0 right-0 px-6"
                style={{
                  bottom: `calc(${eventCollapsedCardHeight} + 2px)`,
                  zIndex: 10,
                }}
              >
                <div className="mx-auto max-w-md">
                  <button
                    type="button"
                    onClick={() => openParticipationForm(displayEvent)}
                    disabled={!canOpenParticipationForm}
                    className={
                      'flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold transition-colors ' +
                      (canOpenParticipationForm
                        ? 'bg-gray-950 text-white active:bg-gray-800 dark:bg-white dark:text-gray-950 dark:active:bg-gray-200'
                        : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500')
                    }
                  >
                    {participationButtonLabel}
                  </button>
                </div>
              </div>
            )}

            <div
              className="absolute left-0 right-0 bg-white dark:bg-[#121212]"
              onTouchStart={handleEventCardTouchStart}
              onTouchMove={handleEventCardTouchMove}
              onTouchEnd={handleEventCardTouchEnd}
              style={{
                bottom: 0,
                height: '100%',
                transform: `translateY(${eventCardTranslateY})`,
                zIndex: 20,
                borderTopLeftRadius: eventCardOpen ? 0 : 20,
                borderTopRightRadius: eventCardOpen ? 0 : 20,
                boxShadow: 'none',
                transition:
                  'transform 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s cubic-bezier(0.4,0,0.2,1)',
                overflow: 'hidden',
                willChange: 'transform',
              }}
            >
              <div className="flex justify-center pb-3 pt-2.5">
                <div className="h-1 w-10 rounded-full bg-gray-300" />
              </div>

              <div
                ref={eventCardScrollRef}
                className="scrollbar-hidden h-full px-5"
                style={{
                  overflowY: eventCardOpen ? 'auto' : 'hidden',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 116px)',
                }}
              >
                <div
                  key={`event-card-${displayEvent.id}`}
                  className="mx-auto max-w-md"
                  style={{
                    animation:
                      eventSwipeDirection === 0
                        ? 'none'
                        : `${eventSwipeDirection > 0 ? 'eventContentSlideInFromRight' : 'eventContentSlideInFromLeft'} 0.34s cubic-bezier(0.22,1,0.36,1)`,
                  }}
                >
                  <div
                    className="overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800"
                    style={{ aspectRatio: '1 / 1' }}
                  >
                    {hasImages && (
                      <div
                        onTouchStart={handleEventPreviewTouchStart}
                        onTouchEnd={handleEventPreviewTouchEnd}
                        onClick={() => {
                          if (eventPreviewSuppressClick.current) {
                            eventPreviewSuppressClick.current = false
                            return
                          }
                          if (eventCardOpen) openLightboxAt(displayImageSlide)
                        }}
                        style={{
                          position: 'relative',
                          height: '100%',
                          width: '100%',
                          overflow: 'hidden',
                          cursor: eventCardOpen ? 'pointer' : 'default',
                          touchAction: 'none',
                        }}
                      >
                        {isCurrentEventImageLoading && (
                          <div
                            className="pointer-events-none absolute inset-0 overflow-hidden"
                            style={{
                              zIndex: 0,
                              background: darkMode ? '#27272a' : '#e5e7eb',
                            }}
                          >
                            <div
                              style={{
                                width: '55%',
                                height: '100%',
                                background: darkMode
                                  ? 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)'
                                  : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)',
                                animation: 'eventImageLoadingShimmer 1.25s ease-in-out infinite',
                              }}
                            />
                          </div>
                        )}
                        <div
                          key={`event-preview-images-${displayEvent.id}`}
                          style={{
                            position: 'relative',
                            zIndex: 1,
                            display: 'flex',
                            height: '100%',
                            opacity: eventPreviewFadingToFirst ? 0 : 1,
                            transform: `translateX(-${displayImageSlide * 100}%)`,
                            transition: eventPreviewFadingToFirst
                              ? 'opacity 0.16s ease'
                              : 'transform 0.3s ease, opacity 0.22s ease',
                            animation:
                              eventSwipeDirection === 0
                                ? 'none'
                                : `${eventSwipeDirection > 0 ? 'eventPreviewImageSlideInFromRight' : 'eventPreviewImageSlideInFromLeft'} 0.34s cubic-bezier(0.22,1,0.36,1)`,
                          }}
                        >
                          {displayImages.map((url, index) => (
                            <div
                              key={`${url}-${index}`}
                              style={{
                                width: '100%',
                                height: '100%',
                                flexShrink: 0,
                                padding: '0 6px',
                                boxSizing: 'border-box',
                              }}
                            >
                              <img
                                src={url}
                                alt=""
                                onLoad={() => markEventPreviewImageLoaded(url)}
                                onError={() =>
                                  setLoadedEventPreviewImages((prev) => ({
                                    ...prev,
                                    [url]: true,
                                  }))
                                }
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  display: 'block',
                                  borderRadius: '12px',
                                  boxShadow: '0 6px 18px rgba(0,0,0,0.16)',
                                  opacity: loadedEventPreviewImages[url] ? 1 : 0,
                                  transition: 'opacity 0.28s ease',
                                }}
                                draggable={false}
                              />
                            </div>
                          ))}
                        </div>
                        {displayImages.length > 1 && (
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: '10px',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              gap: '6px',
                              pointerEvents: eventCardOpen ? 'auto' : 'none',
                            }}
                          >
                            {displayImages.map((_, index) => (
                              <button
                                key={index}
                                type="button"
                                aria-label={`Show event image ${index + 1}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (eventCardOpen && displayEvent) {
                                    setSlide(displayEvent.id, index)
                                  }
                                }}
                                style={{
                                  width: index === displayImageSlide ? 8 : 6,
                                  height: index === displayImageSlide ? 8 : 6,
                                  borderRadius: '999px',
                                  border: 0,
                                  padding: 0,
                                  backgroundColor:
                                    index === displayImageSlide
                                      ? '#ffffff'
                                      : 'rgba(255,255,255,0.55)',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {displayEvent.instagram_url && (
                    <a
                      href={displayEvent.instagram_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden"
                    >
                      Instagram에서 열기
                    </a>
                  )}
                  {displayEvent.description && (
                    <div
                      className="mt-4 rounded-2xl bg-gray-50 px-4 py-4 dark:bg-gray-900"
                      style={{
                        display: eventCardOpen ? 'block' : 'none',
                      }}
                    >
                      <RichText
                        text={displayEvent.description}
                        className="event-description-rich block text-sm leading-relaxed text-gray-700 dark:text-white"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              예정된 이벤트가 없어요
            </p>
          </div>
        )}
      </div>

      {eventListOpen && (
        <div
          className="fixed inset-0"
          style={{
            zIndex: 80,
            backgroundColor: eventListBg,
            backdropFilter: 'blur(22px)',
            WebkitBackdropFilter: 'blur(22px)',
            opacity: eventListClosing ? 0 : 1,
            transition: 'opacity 0.22s ease',
            animation: eventListClosing ? 'none' : 'fadeIn 0.2s ease-out',
          }}
          onClick={closeEventList}
        >
          <div
            className="fixed left-0 right-0 top-0"
            style={{
              height: 'calc(env(safe-area-inset-top) + 64px)',
              backgroundColor: eventListBg,
              zIndex: 4,
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              closeEventList()
            }}
            className="fixed flex h-11 w-11 items-center justify-center"
            aria-label="Close event list"
            style={{
              left: '14px',
              top: 'calc(env(safe-area-inset-top) + 6px)',
              zIndex: 90,
              color: eventListIconColor,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <List size={22} weight="bold" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setEventListNewestFirst((v) => !v)
            }}
            className="fixed flex h-11 w-11 items-center justify-center"
            aria-label={eventListNewestFirst ? 'Sort events old to new' : 'Sort events new to old'}
            style={{
              right: '14px',
              top: 'calc(env(safe-area-inset-top) + 6px)',
              zIndex: 90,
              color: eventListIconColor,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {eventListNewestFirst ? (
              <SortDescending size={22} weight="bold" />
            ) : (
              <SortAscending size={22} weight="bold" />
            )}
          </button>

          <div
            className="absolute left-0 right-0 top-0 px-6"
            style={{
              zIndex: 2,
              paddingTop: 'calc(env(safe-area-inset-top) + 48px)',
              paddingBottom: '10px',
              backgroundColor: eventListBg,
            }}
            onClick={(e) => e.stopPropagation()}
          />

          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: 'calc(env(safe-area-inset-top) + 50px)',
              height: 36,
              zIndex: 2,
              background: eventListFade,
            }}
          />

          <div
            className="event-list-scroll h-full overflow-y-auto px-6 pb-10"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top) + 84px)',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-full max-w-md">
              <div className="space-y-8">
                {groupedListEvents.map((yearGroup) => (
                  <section key={yearGroup.year} className="space-y-2.5">
                    <p
                      className="pb-1 pl-3 pt-1 text-sm font-semibold leading-none"
                      style={{ color: eventListYearColor }}
                    >
                      {yearGroup.year}
                    </p>
                    <div className="space-y-2">
                      {yearGroup.months.flatMap((monthGroup) => monthGroup.events).map((ev) => {
                        const parts = getListDateParts(ev)
                        const selected = ev.id === displayEvent?.id
                        const hasActiveParticipation = !!ev.participation_url && !ev.is_registration_closed
                        const RowCaret = hasActiveParticipation ? CaretDoubleRight : CaretRight
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => selectEventFromList(ev)}
                            className="w-full rounded-2xl border px-3 py-2.5 text-left transition-transform active:scale-[0.99]"
                            style={{
                              ...eventListCardStyle,
                              borderColor: selected ? '#f97316' : eventListCardStyle.borderColor,
                            }}
                          >
                            <div className="flex min-h-[48px] items-center">
                              <div className="w-[46px] shrink-0 text-center">
                                <p
                                  className="text-xs font-semibold leading-none"
                                  style={{ color: eventListMutedColor }}
                                >
                                  {parts.month}
                                </p>
                                <p className="mt-0.5 text-2xl font-medium leading-none">
                                  {parts.day}
                                </p>
                              </div>
                              <div
                                className="ml-2 mr-4 h-9 w-px shrink-0"
                                style={{ backgroundColor: eventListDividerColor }}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">
                                  {ev.title || 'Untitled event'}
                                </p>
                                {ev.location && (
                                  <p
                                    className="mt-1 truncate text-xs"
                                    style={{ color: eventListMutedColor }}
                                  >
                                    {plainText(ev.location)}
                                  </p>
                                )}
                              </div>
                              <RowCaret
                                className="ml-3 shrink-0"
                                size={18}
                                weight="bold"
                                color={eventListChevronColor}
                              />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}

                {allEvents.length === 0 && (
                  <div
                    className="rounded-xl border px-4 py-8 text-center text-sm"
                    style={{
                      ...eventListCardStyle,
                      color: eventListMutedColor,
                    }}
                  >
                    No events yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxIndex !== null && detailImages.length > 0 && (
        <EventLightbox
          imgs={detailImages}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={(index) => {
            if (displayEvent?.id) setSlide(displayEvent.id, index)
          }}
        />
      )}
    </>
  )

}
// Map Tab
function MapTab({ restaurants, member, isValid, isAdmin, authUserId }) {
  const [selected, setSelected] = useState(null)
  const [activeCategory, setActiveCategory] = useState('전체')
  const [stampCardModalOpen, setStampCardModalOpen] = useState(false)
  const [stampCardSpot, setStampCardSpot] = useState(null)
  const [spotCardClosing, setSpotCardClosing] = useState(false)
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    if (!selected) setStampCardModalOpen(false)
  }, [selected])

  const stampCardUserId = member?.user_id || authUserId
  const canSeeStampCard = isValid || isAdmin
  const stampCardEligible = !!(
    selected?.stamp_card_enabled &&
    canSeeStampCard &&
    stampCardUserId &&
    !spotCardClosing
  )

  useEffect(() => {
    if (stampCardEligible) setStampCardSpot(selected)
  }, [selected, stampCardEligible])

  useEffect(() => {
    setSpotCardClosing(false)
  }, [selected?.id])

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

  const filtered = useMemo(
    () =>
      activeCategory === '전체'
        ? restaurants
        : restaurants.filter((r) => r.category === activeCategory),
    [restaurants, activeCategory],
  )

  const visibleCategories = useMemo(
    () => getVisibleMapCategories(restaurants),
    [restaurants],
  )

  useEffect(() => {
    if (!visibleCategories.includes(activeCategory)) {
      setActiveCategory('전체')
    }
  }, [activeCategory, visibleCategories])

  return (
    <div
      className="h-full flex flex-col no-highlight-zone"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Category slider */}
<div 
  className="bg-white px-3 py-3 flex gap-2 overflow-x-auto flex-shrink-0 select-none dark:bg-[#121212]" 
  style={{ 
    paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
    zIndex: 10,  // Keep category slider above the map
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  }} 
>
        {visibleCategories.map((cat) => {
          const isActive = activeCategory === cat
          const iconSvg = isActive
            ? darkMode
              ? CATEGORY_ICONS_BLACK[cat]
              : CATEGORY_ICONS_WHITE[cat]
            : CATEGORY_ICONS_ORANGE[cat]
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
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700')
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

      <div
        className="flex-1 relative overflow-hidden"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <MapView
          restaurants={filtered}
          selected={selected}
          onSelect={setSelected}
        />
        {selected && (
          <SpotCard
            selected={selected}
            onClosingStart={() => setSpotCardClosing(true)}
            onClose={() => setSelected(null)}
          />
        )}

        {/* Stamp card mini widget → fixed top-right, only for valid members */}
        {stampCardSpot && stampCardUserId && (
          <StampCardMini
            restaurantId={stampCardSpot.id}
            userId={stampCardUserId}
            open={stampCardEligible && stampCardSpot.id === selected?.id}
            onOpenModal={() => setStampCardModalOpen(true)}
            onExited={() => {
              if (!stampCardEligible) setStampCardSpot(null)
            }}
          />
        )}

        {/* Stamp card full modal */}
        {stampCardModalOpen && selected && stampCardUserId && (
          <StampCardModal
            restaurantId={selected.id}
            userId={stampCardUserId}
            onClose={() => setStampCardModalOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

if (typeof document !== 'undefined' && !document.getElementById('no-highlight-zone-style')) {
  const style = document.createElement('style')
  style.id = 'no-highlight-zone-style'
  style.textContent = `
    .no-highlight-zone,
    .no-highlight-zone * {
      -webkit-user-select: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
  `
  document.head.appendChild(style)
}
