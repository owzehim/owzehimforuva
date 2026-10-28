import { Desktop, Moon, Sun } from '@phosphor-icons/react'
import { useTheme } from '../hooks/useTheme'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Desktop },
]

export default function ThemeToggle({ disabled = false }) {
  const { theme, setTheme } = useTheme()

  return (
    <div className="grid grid-cols-3 gap-1 rounded-full border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-900">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            disabled={disabled}
            className={
              'flex h-9 items-center justify-center rounded-full text-xs font-semibold transition-colors ' +
              (active
                ? 'bg-[white] text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white')
            }
            aria-label={`Use ${label} theme`}
            title={label}
          >
            <Icon size={17} weight={active ? 'fill' : 'regular'} />
          </button>
        )
      })}
    </div>
  )
}
