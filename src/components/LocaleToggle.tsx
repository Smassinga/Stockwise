import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

type Props = {
  className?: string
  inverse?: boolean
}

export default function LocaleToggle({ className, inverse = false }: Props) {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border p-1 text-xs font-medium',
        inverse
          ? 'border-white/15 bg-black/55 text-white shadow-sm'
          : 'border-border bg-background/90 text-foreground shadow-sm',
        className
      )}
      role="group"
      aria-label={t('locale.selector')}
    >
      {(['en', 'pt'] as const).map((option) => {
        const active = lang === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLang(option)}
            aria-label={option === 'en' ? t('locale.english') : t('locale.portuguese')}
            aria-pressed={active}
            className={cn(
              'rounded-full px-3 py-1.5 transition-colors',
              active
                ? inverse
                  ? 'bg-white text-black'
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
