import { useTheme, useThemeCycle } from '../lib/theme'
import { cx } from './ui'

const LABEL = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function SystemIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

/**
 * Cycles light -> dark -> system.
 *
 * "System" is kept as a real third state rather than being inferred:
 * someone whose OS switches at sunset wants the app to follow, and a plain
 * two-way toggle silently pins them to whichever side they last tapped.
 */
export default function ThemeToggle({ className }) {
  const { choice, isDark } = useTheme()
  const cycle = useThemeCycle()

  const Icon = choice === 'system' ? SystemIcon : choice === 'dark' ? MoonIcon : SunIcon
  const next = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light'

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[choice]}${
        choice === 'system' ? ` (currently ${isDark ? 'dark' : 'light'})` : ''
      } — click for ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}.`}
      className={cx(
        'inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5',
        'text-ink-2 transition hover:bg-hover hover:text-ink',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden text-xs font-medium sm:inline">{LABEL[choice]}</span>
    </button>
  )
}
