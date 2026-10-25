import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { useModalFocus } from '../../../hooks/useModalFocus'
import { useStampCardConfig } from '../hooks/useStampCardConfig'
import { useUserStampVisits } from '../hooks/useUserStampVisits'
import StampCard from './StampCard'

const ORANGE = '#f97316'

export default function StampCardModal({ restaurantId, userId, onClose }) {
  const { config, loading } = useStampCardConfig(restaurantId, { useDefault: true })
  const { stampState } = useUserStampVisits({
    userId,
    restaurantId,
    totalStamps: config?.total_stamps,
  })

  const [visible, setVisible] = useState(false)
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => onClose?.(), 250)
  }
  const handleDialogKeyDown = useModalFocus(dialogRef, handleClose)

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

    if (absDy > absDx && absDy > 60) {
      handleClose()
    }

    touchStartX.current = null
    touchStartY.current = null
  }

  const remaining = config
    ? Math.max(config.total_stamps - stampState.stampsInCurrentCycle, 0)
    : 0
  const isBenefitReady = !!(
    stampState.hasPendingReward ||
    stampState.isCardFull ||
    (config && stampState.stampsInCurrentCycle >= config.total_stamps)
  )
  const shouldHighlight = isBenefitReady || remaining === 1

  return (
    <>
      <style>{`
        @keyframes lightboxZoomIn {
          from {
            transform: scale(0.9);
          }
          to {
            transform: scale(1);
          }
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
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="스탬프 카드"
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
          onClick={(e) => e.stopPropagation()}
          className={visible ? 'lightbox-zoom-enter' : ''}
          style={{
            width: '100%',
            maxWidth: 380,
            maxHeight: '90vh',
            padding: 20,
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            aria-label="스탬프 카드 닫기"
            className="mb-2 self-end flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X size={22} weight="bold" aria-hidden="true" />
          </button>
          {!loading && config && (
            <div style={{ width: '100%' }}>
              <StampCard
                size="full"
                config={config}
                visits={stampState.currentCycleVisits}
                isCardFull={stampState.isCardFull}
                highlighted={shouldHighlight}
                highlightColor={ORANGE}
              />
            </div>
          )}
          <p
            style={{
              margin: '12px 0 0',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 500,
              textAlign: 'center',
              lineHeight: 1.2,
            }}
          >
            Check-IN 시 포인트 자동 적립
          </p>
        </div>
      </div>
    </>
  )
}
