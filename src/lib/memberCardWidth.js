// Width of the membership card on the MY tab. Shared so other elements (the
// update card) can line up with it.
export const MEMBER_CARD_WIDTH =
  'min(var(--membership-card-width, min(calc(100vw - 48px), 448px)), calc((100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 210px) / 1.586))'
