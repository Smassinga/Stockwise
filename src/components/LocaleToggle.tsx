import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

type Props = {
  className?: string
  inverse?: boolean
}

export default function LocaleToggle({ className, inverse = false }: Props) {
  const { lang, setLang } = useI18n()

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border p-1 text-xs font-medium',
        inverse
          ? 'border-white/15 bg-slate-950/50 text-white shadow-sm'
          : 'border-border bg-background/90 text-foreground shadow-sm',
        className
      )}
      role="group"
      aria-label="Language selector"
    >
      {(['en', 'pt'] as const).map((option) => {
        const active = lang === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLang(option)}
            className={cn(
              'rounded-full px-3 py-1.5 transition-colors',
              active
                ? inverse
                  ? 'bg-white text-slate-950'
                  : 'bg-primary text-primary-foreground'
                : inverse
                  ? 'text-white/72 hover:text-white'
                  : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
