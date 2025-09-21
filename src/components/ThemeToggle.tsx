import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export default function ThemeToggle() {
  const [dark, setDark] = useState(
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  )

  useEffect(() => {
    // sync if user hasn’t explicitly chosen (optional)
    const stored = localStorage.getItem('theme')
    if (stored) return
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (localStorage.getItem('theme')) return
      if (mq.matches) document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
      setDark(mq.matches)
    }
    onChange()
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange)
    return () =>
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange)
  }, [])

  const apply = (wantDark: boolean) => {
    const root = document.documentElement
    if (wantDark) {
      root.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
    setDark(wantDark)
  }

  return (
    <button
      type="button"
      onClick={() => apply(!dark)}
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm
                 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
      aria-label="Toggle theme"
      title="Toggle light/dark"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {dark ? 'Light' : 'Dark'}
    </button>
  )
}
