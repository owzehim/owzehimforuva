import { useEffect, useState } from 'react'
import { ChartLine, Money, Star, FireSimple, MapPin } from '@phosphor-icons/react'

import { useActivityStats } from '../hooks/useActivityStats'
import { useRecentVisits } from '../hooks/useRecentVisits'

const W = 'calc(var(--member-screen-width, min(calc(100vw - 32px), 398px)) - 24px)'
// This card sits below a draggable membership card.  Its height is used to
// calculate that card's lift distance, so it must not change when the async
// stats replace the loading skeleton.
// Includes the card's intended bottom breathing room below the third row.
const ACTIVITY_CARD_HEIGHT = '136px'
// Visit rows use a slightly taller line-height than the activity rows.
const RECENT_VISITS_CARD_HEIGHT = '136px'
const RECENT_VISITS_CONTENT_HEIGHT = '76px'

function useDarkMode() {
  const [darkMode, setDarkMode] = useState(() =>
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

  return darkMode
}

function getTheme(darkMode) {
  return {
    // Match UvA-IN wordmark color on MembershipCard
    cardBg: darkMode ? '#A1A1AA' : '#2C2A27',

    // Dark mode requested: black + dark grey text on the boxes
    titleText: darkMode ? '#111111' : '#F6F4F1',
    mainText: darkMode ? '#111111' : '#F6F4F1',
    subText: darkMode ? 'rgba(17,17,17,0.68)' : 'rgba(246,244,241,0.72)',
    mutedText: darkMode ? 'rgba(17,17,17,0.48)' : 'rgba(246,244,241,0.48)',
    skeleton: darkMode ? 'rgba(17,17,17,0.12)' : 'rgba(246,244,241,0.12)',
  }
}

export default function ActivityStatsCard({ userId }) {
  const darkMode = useDarkMode()
  const theme = getTheme(darkMode)

  const { stats, loading } = useActivityStats(userId)
  const { visits, loading: visitsLoading } = useRecentVisits(userId)

  return (
    <>
      {/* 기존 "이번 달 활동" 카드 */}
      <div
        style={{
          width: W,
          margin: '0 auto',
          background: theme.cardBg,
          borderRadius: '16px',
          padding: '16px 20px 16px',
          boxSizing: 'border-box',
          height: ACTIVITY_CARD_HEIGHT,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <ChartLine size={16} color={theme.titleText} />

          <h3
            style={{
              fontFamily: 'var(--font-app)',
              fontWeight: 700,
              fontSize: '15px',
              color: theme.titleText,
              letterSpacing: '0.04em',
              margin: 0,
            }}
          >
            이번 달 활동
          </h3>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '63px' }}>
            {[70, 80, 60].map((w, i) => (
              <div
                key={i}
                style={{
                  // Match the rendered StatRow line height so the card does not resize after loading.
                  height: '15px',
                  width: `${w}%`,
                  background: theme.skeleton,
                  borderRadius: '6px',
                }}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '63px' }}>
            <StatRow
              icon={Money}
              label="받은 할인"
              value={stats.discountCount}
              unit="회"
              theme={theme}
            />
            <StatRow
              icon={Star}
              label="남긴 리뷰"
              value={stats.reviewCount}
              unit="개"
              theme={theme}
            />
            <StatRow
              icon={FireSimple}
              label="연속 방문"
              value={stats.streakDays}
              unit="일"
              highlight={stats.streakDays >= 3}
              theme={theme}
            />
          </div>
        )}
      </div>

      {/* 새로운 "최근 방문" 카드 */}
      <RecentVisitsCard visits={visits} loading={visitsLoading} theme={theme} />
    </>
  )
}

function StatRow({ icon: Icon, label, value, unit, highlight = false, theme }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon size={13} color={theme.subText} />

        <span
          style={{
            color: theme.subText,
            fontFamily: 'var(--font-app)',
            letterSpacing: '0.03em',
          }}
        >
          {label}
        </span>
      </div>

      <span
        style={{
          fontWeight: 700,
          fontFamily: 'var(--font-app)',
          letterSpacing: '0.04em',
          color: highlight ? theme.mainText : theme.mainText,
        }}
      >
        {value}{' '}
        <span
          style={{
            fontWeight: 400,
            fontFamily: 'var(--font-app)',
            color: theme.mutedText,
          }}
        >
          {unit}
        </span>
      </span>
    </div>
  )
}

function RecentVisitsCard({ visits, loading, theme }) {
  const visitSlots = Array.from({ length: 3 }, (_, index) => (
    visits[index] || { placeName: '---', redeemedAt: null, isPlaceholder: true }
  ))

  return (
    <div
      style={{
        width: W,
        margin: '12px auto 0',
        background: theme.cardBg,
        borderRadius: '16px',
        padding: '16px 20px',
        boxSizing: 'border-box',
        height: RECENT_VISITS_CARD_HEIGHT,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '10px',
        }}
      >
        <MapPin size={16} color={theme.titleText} />

        <h3
          style={{
            fontFamily: 'var(--font-app)',
            fontWeight: 700,
            fontSize: '15px',
            color: theme.titleText,
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          최근 방문
        </h3>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: RECENT_VISITS_CONTENT_HEIGHT }}>
          {[100, 90, 80].map((w, i) => (
            <div
              key={i}
              style={{
                // Match the rendered visit-row line height so the card does not resize after loading.
                height: '15px',
                width: `${w}%`,
                background: theme.skeleton,
                borderRadius: '6px',
              }}
            />
          ))}
        </div>
      ) : false ? (
        <p
          style={{
            fontSize: '13px',
            color: theme.subText,
            margin: 0,
          }}
        >
          최근 방문 내역이 없습니다
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            height: RECENT_VISITS_CONTENT_HEIGHT,
          }}
        >
          {visitSlots.map((v, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '13px',
              }}
            >
              <span
                style={{
                  color: v.isPlaceholder ? theme.mutedText : theme.mainText,
                  fontFamily: 'var(--font-app)',
                  letterSpacing: '0.03em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginRight: '8px',
                }}
              >
                {v.placeName}
              </span>

              <span
                style={{
                  color: theme.mutedText,
                  fontFamily: 'var(--font-app)',
                  letterSpacing: '0.03em',
                  flexShrink: 0,
                }}
              >
                {v.isPlaceholder ? '---' : formatVisitDate(v.redeemedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatVisitDate(dateStr) {
  if (!dateStr) return ''

  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')

  return `${y}-${m}-${day} ${h}:${min}`
}
