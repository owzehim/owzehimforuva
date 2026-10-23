import { CheckCircle } from '@phosphor-icons/react'

export default function AdminBadge({ size = 15 }) {
  return (
    <CheckCircle
      size={size}
      weight="fill"
      className="inline-block shrink-0 align-[-2px] text-blue-500 dark:text-blue-400"
      role="img"
      aria-label="관리자"
      title="관리자"
    />
  )
}
