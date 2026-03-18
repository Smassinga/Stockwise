import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { useI18n } from '../lib/i18n'

type Props = { compact?: boolean }

export default function ThemeToggle({ compact = false }: Props) {
  const { t } = useI18n()
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
        size="icon"
        aria-label={t('theme.toggle')}
        title={t('theme.toggle')}
        onClick={() => apply(!dark)}
        className="h-10 w-10 shrink-0 overflow-visible rounded-xl border border-transparent p-0 hover:border-border/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => apply(!dark)}
      className="inline-flex min-h-10 min-w-0 shrink-0 items-center gap-2 overflow-visible rounded-xl border px-3 py-2 text-sm
                 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {dark ? t('theme.light') : t('theme.dark')}
    </button>
  )
}
