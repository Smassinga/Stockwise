import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BankIcon } from '@phosphor-icons/react/dist/csr/Bank'
import { CashRegisterIcon } from '@phosphor-icons/react/dist/csr/CashRegister'
import { ChartBarIcon } from '@phosphor-icons/react/dist/csr/ChartBar'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/csr/DeviceMobile'
import { FactoryIcon } from '@phosphor-icons/react/dist/csr/Factory'
import { InvoiceIcon } from '@phosphor-icons/react/dist/csr/Invoice'
import { PlantIcon } from '@phosphor-icons/react/dist/csr/Plant'
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { WarningDiamondIcon } from '@phosphor-icons/react/dist/csr/WarningDiamond'
import { cn } from '../../lib/utils'

export type LandingProductSurface = 'dashboard' | 'stock' | 'documents' | 'production' | 'growth' | 'mobile'

export type LandingProductTab = {
  id: string
  label: string
  eyebrow: string
  title: string
  body: string
  points: string[]
  surface: LandingProductSurface
}

type SurfaceCopy = {
  tabListLabel: string
  sampleOnly: string
  preview: string
  rows: Record<LandingProductSurface, Array<{ label: string; value: string }>>
}

type LandingProductTabsProps = {
  tabs: LandingProductTab[]
  copy: SurfaceCopy
}

const surfaceIconMap = {
  dashboard: ChartBarIcon,
  stock: StackIcon,
  documents: InvoiceIcon,
  production: FactoryIcon,
  growth: PlantIcon,
  mobile: DeviceMobileIcon,
} satisfies Record<LandingProductSurface, typeof ChartBarIcon>

const surfaceRowMeta = {
  dashboard: [
    { icon: StackIcon, level: 78 },
    { icon: CashRegisterIcon, level: 58 },
    { icon: ChartBarIcon, level: 68 },
  ],
  stock: [
    { icon: StackIcon, level: 82 },
    { icon: CashRegisterIcon, level: 64 },
    { icon: WarningDiamondIcon, level: 36 },
  ],
  documents: [
    { icon: InvoiceIcon, level: 72 },
    { icon: BankIcon, level: 54 },
    { icon: CheckCircleIcon, level: 46 },
  ],
  production: [
    { icon: StackIcon, level: 64 },
    { icon: FactoryIcon, level: 76 },
    { icon: CheckCircleIcon, level: 58 },
  ],
  growth: [
    { icon: PlantIcon, level: 70 },
    { icon: WarningDiamondIcon, level: 34 },
    { icon: CheckCircleIcon, level: 48 },
  ],
  mobile: [
    { icon: CashRegisterIcon, level: 62 },
    { icon: StackIcon, level: 74 },
    { icon: DeviceMobileIcon, level: 52 },
  ],
} satisfies Record<LandingProductSurface, Array<{ icon: typeof ChartBarIcon; level: number }>>

function ProductSurface({ tab, copy }: { tab: LandingProductTab; copy: SurfaceCopy }) {
  const SurfaceIcon = surfaceIconMap[tab.surface]
  const rows = useMemo(() => {
    const rowCopy = copy.rows[tab.surface]
    const rowMeta = surfaceRowMeta[tab.surface]

    return rowCopy.map((row, index) => ({
      ...row,
      icon: rowMeta[index]?.icon ?? CheckCircleIcon,
      level: rowMeta[index]?.level ?? 50,
    }))
  }, [copy.rows, tab.surface])

  return (
    <div className="landing-product-surface">
      <div className="landing-product-surface__header">
        <div>
          <div className="landing-product-surface__eyebrow">{copy.preview}</div>
          <h3 className="landing-product-surface__title">{tab.title}</h3>
        </div>
        <div className="landing-product-surface__badge" aria-hidden="true">
          <SurfaceIcon className="h-5 w-5" weight="duotone" />
        </div>
      </div>

      <div className="landing-product-surface__body">
        <div className="landing-product-surface__ledger">
          {rows.map((row) => {
            const RowIcon = row.icon
            return (
              <div key={`${tab.id}-${row.label}`} className="landing-product-surface__row">
                <RowIcon className="h-4 w-4 text-primary" weight="duotone" aria-hidden="true" />
                <span className="landing-product-surface__row-label">{row.label}</span>
                <span className="landing-product-surface__row-value">{row.value}</span>
                <span
                  className="landing-preview-bar"
                  style={{ '--landing-preview-level': `${row.level}%` } as CSSProperties}
                  aria-hidden="true"
                >
                  <span className="landing-preview-bar__fill" />
                </span>
              </div>
            )
          })}
        </div>

        <div className="landing-product-surface__points">
          {tab.points.map((point) => (
            <div key={point} className="flex gap-2 text-sm leading-6 text-slate-300">
              <CheckCircleIcon className="mt-1 h-4 w-4 shrink-0 text-emerald-300" weight="duotone" aria-hidden="true" />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="landing-product-surface__footer">{copy.sampleOnly}</div>
    </div>
  )
}

export function LandingProductTabs({ tabs, copy }: LandingProductTabsProps) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const shouldReduceMotion = useReducedMotion()
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[0]?.id ?? '')
    }
  }, [activeId, tabs])

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = tabs.length - 1
    let nextIndex = index

    if (event.key === 'ArrowRight') nextIndex = index === lastIndex ? 0 : index + 1
    if (event.key === 'ArrowLeft') nextIndex = index === 0 ? lastIndex : index - 1
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = lastIndex

    if (nextIndex !== index) {
      event.preventDefault()
      const nextTab = tabs[nextIndex]
      setActiveId(nextTab.id)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  if (!activeTab) return null

  return (
    <div className="landing-tabs">
      <div className="landing-tabs__list" role="tablist" aria-label={copy.tabListLabel}>
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab.id
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`landing-panel-${tab.id}`}
              id={`landing-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn('landing-tabs__tab', selected ? 'landing-tabs__tab--active' : '')}
            >
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab.id}
          id={`landing-panel-${activeTab.id}`}
          role="tabpanel"
          aria-labelledby={`landing-tab-${activeTab.id}`}
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 10, x: 12 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -6, x: -10 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="landing-tabs__panel"
        >
          <div>
            <div className="landing-tabs__eyebrow">{activeTab.eyebrow}</div>
            <h3 className="mt-2 text-3xl font-semibold leading-tight text-white sm:text-4xl">{activeTab.title}</h3>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">{activeTab.body}</p>
          </div>
          <ProductSurface tab={activeTab} copy={copy} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
