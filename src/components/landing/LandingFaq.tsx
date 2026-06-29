import { useEffect, useState } from 'react'
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question'
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
    <div className="landing-faq">
      {items.map((item) => {
        const open = item.id === openItemId
        const panelId = `landing-faq-${item.id}`

        return (
          <div key={item.id} className={cn('landing-faq__item', open ? 'landing-faq__item--open' : '')}>
            <button
              type="button"
              className="landing-faq__button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenItemId(open ? '' : item.id)}
            >
              <span className="landing-faq__icon" aria-hidden="true">
                <QuestionIcon className="h-5 w-5" weight="duotone" />
              </span>
              <span className="landing-faq__question">{item.question}</span>
              <ChevronDown className={cn('landing-faq__chevron', open ? 'rotate-180' : '')} aria-hidden="true" />
            </button>
            <div id={panelId} className="landing-faq__answer" hidden={!open}>
              {item.answer}
            </div>
          </div>
        )
      })}
    </div>
  )
}
