import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export type LandingFaqItem = {
  id: string
  question: string
  answer: string
}

type LandingFaqProps = {
  items: LandingFaqItem[]
}

export function LandingFaq({ items }: LandingFaqProps) {
  const [openItemId, setOpenItemId] = useState(items[0]?.id ?? '')

  useEffect(() => {
    if (openItemId && items.some((item) => item.id === openItemId)) return
    setOpenItemId(items[0]?.id ?? '')
  }, [items, openItemId])

  return (
    <div className="border-t border-border">
      {items.map((item) => {
        const open = item.id === openItemId
        const panelId = `landing-faq-${item.id}`
        const buttonId = `${panelId}-button`

        return (
          <div key={item.id} className="border-b border-border">
            <h3>
              <button
                id={buttonId}
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-5 py-5 text-left text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenItemId(open ? '' : item.id)}
              >
                <span>{item.question}</span>
                <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open ? 'rotate-180' : '')} aria-hidden="true" />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} className="pb-6 pr-10 text-sm leading-7 text-muted-foreground" hidden={!open}>
              <p>{item.answer}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
