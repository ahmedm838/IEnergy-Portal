import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'attendance-theme'
const ThemeContext = createContext(null)

/** Reading localStorage throws in some privacy modes, so never let it escape. */
function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

export function applyTheme(choice) {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  return dark
}

/**
 * Theme preference: 'light', 'dark', or 'system'.
 *
 * Stored per browser, so it is a personal preference rather than account
 * data — it deliberately does not sync across devices or users.
 */
export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(readStored)
  const [isDark, setIsDark] = useState(() => applyTheme(readStored()))

  useEffect(() => {
    setIsDark(applyTheme(choice))
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Private mode or blocked storage: the theme still applies for this
      // session, it just will not be remembered.
    }
  }, [choice])

  // Follow the OS while the preference is 'system'.
  useEffect(() => {
    if (choice !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setIsDark(applyTheme('system'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice])

  const value = useMemo(
    () => ({
      choice,
      isDark,
      setChoice,
      toggle: () => setChoice(isDark ? 'light' : 'dark'),
    }),
    [choice, isDark],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/** Cycles light -> dark -> system, with a plain click toggling the first two. */
export function useThemeCycle() {
  const { choice, setChoice } = useTheme()
  return useCallback(() => {
    setChoice(choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light')
  }, [choice, setChoice])
}
