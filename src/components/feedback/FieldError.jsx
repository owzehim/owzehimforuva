import { WarningCircle, XCircle } from '@phosphor-icons/react'

/** Error line under a form field (#3). Pair with invalidFieldClass on the field. */
export function FieldError({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
      <WarningCircle size={14} weight="fill" className="flex-shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

/** Extra classes for a field that has an error. */
export const invalidFieldClass = '!border-red-500 !bg-red-50 dark:!bg-red-500/10'

/** Error box inside a panel or form (#4). */
export function InlineAlert({ title, children }) {
  if (!title && !children) return null
  return (
    <div role="alert" className="flex gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-left dark:border-red-500/30 dark:bg-red-500/10">
      <XCircle size={22} weight="fill" className="flex-shrink-0 text-red-500" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="break-keep text-sm font-semibold text-red-800 dark:text-red-300">{title}</p>}
        {children && <p className="mt-0.5 break-keep text-xs leading-snug text-red-700 dark:text-red-300/80">{children}</p>}
      </div>
    </div>
  )
}
