import { X } from '@phosphor-icons/react'

export default function LightboxCloseButton({ onClose, label }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="lightbox-close-button fixed right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      onPointerDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <X size={22} weight="bold" aria-hidden="true" />
    </button>
  )
}
