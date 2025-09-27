import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'

type Props = { compact?: boolean }

export default function ThemeToggle({ compact = false }: Props) {
  const [dark, setDark] = useState(
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  )

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (localStorage.getItem('theme')) return
      document.documentElement.classList.toggle('dark', mq.matches)
      setDark(mq.matches)
    }
    onChange()
    // @ts-ignore Safari fallback
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange)
    return () =>
      // @ts-ignore
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange)
  }, [])

  const apply = (wantDark: boolean) => {
    document.documentElement.classList.toggle('dark', wantDark)
    localStorage.setItem('theme', wantDark ? 'dark' : 'light')
    setDark(wantDark)
  }

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label="Toggle theme"
        title="Toggle light/dark"
        onClick={() => apply(!dark)}
      >
        {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>
    )
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
