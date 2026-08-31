// ─────────────────────────────────────────────────────────────
// ReviewModal
// The popup shown to members 30 minutes after a store visit in production.
// Receives all state and actions from useReviewPrompt hook —
// this component is purely presentational.
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { Star, StarHalf, BowlSteam, HandHeart, Wine, CoinVertical, X } from '@phosphor-icons/react'
import { REVIEW_TAGS } from '../domain/reviewTypes'

const TAG_ICONS = {
  BowlSteam,
  HandHeart,
  Wine,
  CoinVertical,
}

// ── Star row ─────────────────────────────────────────────────
// rating can be a whole number (1–5) or a half (0.5–4.5).
// Tap a star once  → whole rating (e.g. 4)
// Tap same star again → half rating one step below (e.g. 3.5)
function StarRow({ rating, onSelect, error }) {
  function starWeight(value) {
    if (rating === null) return 'regular'
    if (value < rating) return 'fill'
    if (value === Math.ceil(rating) && rating % 1 !== 0) return 'half'
    if (value <= rating) return 'fill'
    return 'regular'
  }

  function handleStarClick(value) {
    if (rating === value) {
      onSelect(value - 0.5)
    } else {
      onSelect(value)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm font-medium text-gray-700">이 장소는 몇 점인가요?</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((value) => {
          const weight = starWeight(value)
          return (
            <button
              key={value}
              onClick={() => handleStarClick(value)}
              className="p-1 transition-transform active:scale-90"
              aria-label={`${value}점`}
            >
              {weight === 'half' ? (
                <StarHalf size={36} weight="fill" color="#f97316" />
              ) : (
                <Star
                  size={36}
                  weight={weight}
                  color={weight !== 'regular' ? '#f97316' : '#d1d5db'}
                />
              )}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ── Tag chip ─────────────────────────────────────────────────
function TagChip({ tag, selected, onToggle }) {
  const IconComponent = TAG_ICONS[tag.icon]
  return (
    <button
      onClick={() => onToggle(tag.key)}
      className={`
        flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border text-sm font-medium
        transition-all active:scale-95
        ${
          selected
            ? 'bg-orange-500 border-orange-500 text-white'
            : 'bg-white border-gray-200 text-gray-600 hover:border-orange-300'
        }
      `}
    >
      {IconComponent && (
        <IconComponent
          size={16}
          weight={selected ? 'fill' : 'regular'}
          color={selected ? '#ffffff' : '#9ca3af'}
        />
      )}
      {tag.label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────
export default function ReviewModal({
  open,
  storeName,
  rating,
  tags,
  comment,
  errors,
  submitError,
  submitting,
  onSelectRating,
  onToggleTag,
  onCommentChange,
  onSubmit,
  onSkip,
}) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  const touchStartY = useRef(null)
  const touchStartX = useRef(null)
  const sheetRef = useRef(null)

  useEffect(() => {
    if (open) {
      setClosing(false)
      requestAnimationFrame(() => setVisible(true))
    }
  }, [open])

  const handleClose = () => {
    setVisible(false)
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      onSkip()
    }, 320)
  }

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e) => {
    if (touchStartY.current == null) return
    const dy = e.changedTouches[0].clientY - touchStartY.current
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX.current)
    touchStartY.current = null
    touchStartX.current = null
    if (dy > 60 && dy > dx) {
      handleClose()
    }
  }

  if (!open && !closing) return null

  return (
    <>
      {/* Backdrop — fades in/out */}
      <div
        className="fixed inset-0 z-[1100]"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.38s ease',
        }}
        onClick={handleClose}
      />

      {/* Sheet — slides up from bottom */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-[1200] bg-white rounded-t-3xl"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
          maxHeight: '92dvh',
          overflowY: 'auto',
          transform: visible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 104%, 0)',
          transition: visible
            ? 'transform 0.48s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'transform 0.28s cubic-bezier(0.4, 0, 1, 1)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <div>
            <p className="text-xs text-orange-500 font-medium mb-0.5">가본 사람 한마디</p>
            <h2 className="text-base font-bold text-gray-900">{storeName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              추천 메뉴나 매장 분위기, 다음 사람을 위한 꿀팁을 남겨주세요!
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex-shrink-0"
            aria-label="닫기"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-5 flex flex-col gap-6 pb-4">
          {/* Star rating */}
          <StarRow rating={rating} onSelect={onSelectRating} error={errors.rating} />

          {/* Tag chips — 2×2 centered grid */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">
              어떤 점이 좋았나요?{' '}
              <span className="text-gray-400 font-normal ml-1">(복수 선택 가능)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {REVIEW_TAGS.map((tag) => (
                <TagChip
                  key={tag.key}
                  tag={tag}
                  selected={tags.includes(tag.key)}
                  onToggle={onToggleTag}
                />
              ))}
            </div>
            {errors.tags && <p className="text-xs text-red-500">{errors.tags}</p>}
          </div>

          {/* Comment */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">
              한 줄 후기{' '}
              <span className="text-gray-400 font-normal ml-1">(선택)</span>
            </p>
            <textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="이곳에서의 경험을 공유해 주세요."
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2.5 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-2xl resize-none focus:outline-none focus:border-orange-400 placeholder:text-gray-400"
            />
            <p className="text-xs text-gray-400 text-right">{comment.length}/200</p>
          </div>

          {/* Server error */}
          {submitError && (
            <p className="text-xs text-red-500 text-center">{submitError}</p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="w-full py-3.5 bg-orange-500 text-white font-semibold rounded-2xl text-sm hover:bg-orange-600 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? '저장 중...' : '한마디 등록'}
            </button>
            <button
              onClick={handleClose}
              disabled={submitting}
              className="w-full py-3 text-gray-400 text-sm hover:text-gray-600 transition-colors"
            >
              다음에 할게요
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
