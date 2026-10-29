import { useRef, useState } from 'react'
import { CaretLeft, CaretRight, Image as ImageIcon } from '@phosphor-icons/react'

export default function EventListPreview({ event, backgroundColor, onSelect }) {
  const images = event?.image_urls || []
  const [index, setIndex] = useState(0)
  const gesture = useRef(null)
  const move = (direction) => setIndex((current) =>
    Math.max(0, Math.min(images.length - 1, current + direction)))

  return (
    <div className="event-list-landscape-preview">
      <div
        className="event-list-landscape-artwork"
        style={{ backgroundColor }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          e.stopPropagation()
          move(e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        <button
          type="button"
          className="event-list-landscape-image-button"
          disabled={!event}
          aria-label={`Open event: ${event?.title || 'Untitled event'}`}
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0) return
            gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const start = gesture.current
            if (start?.id !== e.pointerId) return
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) start.moved = true
          }}
          onPointerUp={(e) => {
            const start = gesture.current
            if (start?.id !== e.pointerId) return
            const dx = e.clientX - start.x
            const dy = e.clientY - start.y
            if (Math.hypot(dx, dy) > 8) start.moved = true
            if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1)
          }}
          onPointerCancel={() => { gesture.current = { moved: true } }}
          onClick={(e) => {
            if (e.detail !== 0 && gesture.current?.moved) return
            if (event) onSelect(event)
          }}
        >
          {images[index] ? (
            <img src={images[index]} alt={event?.title || 'Event preview'} draggable={false} />
          ) : (
            <div className="event-list-landscape-no-image flex flex-col gap-3 bg-white text-gray-400 dark:bg-[#121212] dark:text-gray-500">
              <ImageIcon size={34} weight="regular" />
              <span className="text-xs">No images</span>
            </div>
          )}
        </button>
        {images.length > 1 && (
          <>
            <button type="button" className="event-list-image-nav is-previous" aria-label="Previous event image" disabled={index === 0} onClick={() => move(-1)}>
              <CaretLeft size={20} weight="bold" />
            </button>
            <button type="button" className="event-list-image-nav is-next" aria-label="Next event image" disabled={index === images.length - 1} onClick={() => move(1)}>
              <CaretRight size={20} weight="bold" />
            </button>
            <span className="event-list-image-count" aria-live="polite">{index + 1} / {images.length}</span>
          </>
        )}
      </div>
    </div>
  )
}
