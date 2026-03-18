import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Building2,
  CheckCircle2,
  Languages,
  LineChart,
  Menu,
  RefreshCcw,
  ShieldCheck,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import BrandLockup from '../components/brand/BrandLockup'
import LocaleToggle from '../components/LocaleToggle'
import ThemeToggle from '../components/ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

type Feature = {
  title: string
  body: string
  icon: typeof Boxes
}

type Plan = {
  title: string
  body: string
  points: string[]
}

type SurfaceSignal = {
  label: string
  body: string
  tone?: 'default' | 'accent'
}

type Copy = {
  nav: Array<{ label: string; href: string }>
  heroEyebrow: string
  heroTitle: string
  heroBody: string
  heroSupport: string
  primaryCta: string
  secondaryCta: string
  valueStrip: string
  featuresTitle: string
  featuresBody: string
  features: Feature[]
  workflowTitle: string
  workflowBody: string
  workflowSteps: string[]
  kpiTitle: string
  kpiBody: string
  aboutTitle: string
  aboutBody: string
  aboutPoints: string[]
  getStartedTitle: string
  getStartedBody: string
  plans: Plan[]
  finalTitle: string
  finalBody: string
  finalCta: string
  signIn: string
  footerTagline: string
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    nav: [
      { label: 'Product', href: '#product' },
      { label: 'Features', href: '#features' },
      { label: 'Get Started', href: '#get-started' },
      { label: 'About', href: '#about' },
    ],
    heroEyebrow: 'Stock, orders, cash, and margin in one workspace',
    heroTitle: 'Run inventory operations with fewer blind spots',
    heroBody:
      'StockWise gives operations teams one place to control inventory, warehouses, orders, transactions, and financial visibility without bouncing between spreadsheets.',
    heroSupport: 'Portuguese-ready workflows for teams that need clarity from receiving to settlement.',
    primaryCta: 'Start with StockWise',
    secondaryCta: 'Sign in',
    valueStrip: 'One operational system for stock control, order execution, cash tracking, and margin visibility.',
    featuresTitle: 'Built for daily operational control',
    featuresBody:
      'The public experience should explain the product the same way the product behaves: clearly, directly, and around the work teams do every day.',
    features: [
      {
        title: 'See stock with confidence',
        body: 'Track on-hand quantities, low-stock risk, and inventory value across warehouses without waiting for spreadsheet cleanups.',
        icon: Boxes,
      },
      {
        title: 'Move inventory cleanly',
        body: 'Record receipts, issues, transfers, and adjustments with traceable movement history and warehouse context.',
        icon: RefreshCcw,
      },
      {
        title: 'Keep warehouses organised',
        body: 'Work with warehouses, bins, and stock levels in a way that mirrors how teams actually operate on the ground.',
        icon: Warehouse,
      },
      {
        title: 'Run orders with context',
        body: 'Connect customers, suppliers, sales orders, purchase orders, and downstream stock activity in one workflow.',
        icon: Building2,
      },
      {
        title: 'Track cash and bank activity',
        body: 'Stay on top of transactions, cash positions, bank accounts, and settlement flow from the same system.',
        icon: Wallet,
      },
      {
        title: 'See revenue and margin together',
        body: 'Use dashboards and reports that put revenue, COGS, stock value, and gross margin in the same operational picture.',
        icon: LineChart,
      },
    ],
    workflowTitle: 'From receipt to reporting, under control',
    workflowBody:
      'StockWise follows the real movement of goods and money: receive stock, store it correctly, fulfill demand, and reconcile what actually happened.',
    workflowSteps: ['Receive', 'Store', 'Move', 'Sell', 'Ship', 'Collect', 'Reconcile'],
    kpiTitle: 'The signals teams actually use',
    kpiBody:
      'The product keeps the few operational views that matter visible instead of burying them under decorative dashboard noise.',
    aboutTitle: 'Designed for practical inventory and sales operations',
    aboutBody:
      'StockWise is for teams that need the system of record and the daily operating screen to be the same product.',
    aboutPoints: [
      'Shared EN/PT runtime experience across landing, login, and the authenticated app',
      'Clean route protection for dashboard and internal pages',
      'Operational UI language aligned with the product itself',
    ],
    getStartedTitle: 'Choose how to start',
    getStartedBody:
      'The onboarding entry points are framed around real rollout needs instead of placeholder pricing plans.',
    plans: [
      {
        title: 'Self-serve workspace',
        body: 'Best for teams already ready to configure items, warehouses, and users internally.',
        points: ['Immediate sign-in', 'Internal setup ownership', 'Fastest path to dashboard'],
      },
      {
        title: 'Guided setup',
        body: 'For teams migrating from spreadsheets and wanting a cleaner first implementation.',
        points: ['Structured setup support', 'Company data preparation', 'Safer operational rollout'],
      },
      {
        title: 'Operational rollout',
        body: 'For larger deployments needing staged adoption across locations, roles, and processes.',
        points: ['Role-aware implementation', 'Process alignment', 'Controlled adoption by team'],
      },
    ],
    finalTitle: 'Bring stock and operations into one reliable system',
    finalBody:
      'Move from disconnected tracking to one workspace where inventory, orders, transactions, and reporting stay aligned.',
    finalCta: 'Open StockWise',
    signIn: 'Sign in',
    footerTagline: 'Inventory operations, order execution, and cash visibility in one place.',
  },
  pt: {
    nav: [
      { label: 'Produto', href: '#product' },
      { label: 'Funcionalidades', href: '#features' },
      { label: 'Começar', href: '#get-started' },
      { label: 'Sobre', href: '#about' },
    ],
    heroEyebrow: 'Stock, encomendas, caixa e margem num só workspace',
    heroTitle: 'Controle a operação de inventário com menos pontos cegos',
    heroBody:
      'O StockWise dá às equipas operacionais um único lugar para gerir stock, armazéns, encomendas, transações e visibilidade financeira sem saltar entre folhas de cálculo.',
    heroSupport: 'Tudo no sítio, do stock ao recebimento.',
    primaryCta: 'Começar com StockWise',
    secondaryCta: 'Iniciar sessão',
    valueStrip: 'Um único sistema operacional para controlo de stock, execução de encomendas, caixa e visibilidade de margem.',
    featuresTitle: 'Criado para controlo operacional diário',
    featuresBody:
      'A experiência pública deve explicar o produto da mesma forma que o produto funciona: de forma clara, directa e focada no trabalho diário da equipa.',
    features: [
      {
        title: 'Ver stock com confiança',
        body: 'Acompanhe quantidades em mão, risco de rutura e valor de inventário por armazém sem depender de folhas manuais.',
        icon: Boxes,
      },
      {
        title: 'Movimentar inventário sem ruído',
        body: 'Registe entradas, saídas, transferências e ajustes com histórico rastreável e contexto operacional.',
        icon: RefreshCcw,
      },
      {
        title: 'Organizar armazéns com clareza',
        body: 'Trabalhe com armazéns, bins e níveis de stock de forma alinhada ao que acontece no terreno.',
        icon: Warehouse,
      },
      {
        title: 'Gerir encomendas com contexto',
        body: 'Ligue clientes, fornecedores, encomendas e atividade de stock no mesmo fluxo operacional.',
        icon: Building2,
      },
      {
        title: 'Acompanhar caixa e bancos',
        body: 'Tenha controlo sobre transações, caixa, contas bancárias e liquidação a partir do mesmo sistema.',
        icon: Wallet,
      },
      {
        title: 'Ver receita e margem juntas',
        body: 'Use painéis e relatórios que colocam receita, CMVMC, valor de stock e margem bruta na mesma leitura.',
        icon: LineChart,
      },
    ],
    workflowTitle: 'Da receção ao relatório, com controlo',
    workflowBody:
      'O StockWise acompanha o fluxo real de mercadoria e dinheiro: receber, armazenar, movimentar, vender, expedir e reconciliar o que realmente aconteceu.',
    workflowSteps: ['Receber', 'Guardar', 'Mover', 'Vender', 'Expedir', 'Receber', 'Reconciliar'],
    kpiTitle: 'Os sinais que a equipa realmente usa',
    kpiBody:
      'O produto mantém visível a leitura operacional que importa, em vez de esconder tudo atrás de um dashboard decorativo.',
    aboutTitle: 'Feito para operações práticas de stock e vendas',
    aboutBody:
      'O StockWise é para equipas que precisam que o sistema de registo e o ecrã operacional do dia a dia sejam o mesmo produto.',
    aboutPoints: [
      'Experiência EN/PT consistente entre landing page, login e aplicação autenticada',
      'Proteção real de rotas para dashboard e páginas internas',
      'Linguagem operacional alinhada com o produto',
    ],
    getStartedTitle: 'Escolha como começar',
    getStartedBody:
      'Os pontos de entrada foram organizados à volta de necessidades reais de rollout, e não de planos de pricing inventados.',
    plans: [
      {
        title: 'Workspace self-serve',
        body: 'Melhor para equipas prontas para configurar artigos, armazéns e utilizadores por conta própria.',
        points: ['Entrada imediata', 'Configuração interna', 'Caminho mais curto para o dashboard'],
      },
      {
        title: 'Setup guiado',
        body: 'Para equipas a sair de folhas de cálculo e que querem uma primeira implementação mais limpa.',
        points: ['Apoio na configuração', 'Preparação de dados', 'Rollout operacional mais seguro'],
      },
      {
        title: 'Rollout operacional',
        body: 'Para implementações maiores com adoção faseada por local, função e processo.',
        points: ['Implementação por papéis', 'Alinhamento de processos', 'Adoção controlada'],
      },
    ],
    finalTitle: 'Traga o stock e a operação para um sistema fiável',
    finalBody:
      'Passe de controlo disperso para um workspace único onde inventário, encomendas, transações e relatórios permanecem alinhados.',
    finalCta: 'Abrir StockWise',
    signIn: 'Iniciar sessão',
    footerTagline: 'Operações de inventário, execução de encomendas e visibilidade de caixa num só lugar.',
  },
}

function SurfaceSignalCard({
  label,
  body,
  tone = 'default',
}: {
  label: string
  body: string
  tone?: 'default' | 'accent'
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-4',
        tone === 'accent'
          ? 'border-amber-200/80 bg-amber-50/90 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'border-border/70 bg-background'
      )}
    >
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{body}</div>
    </div>
  )
}

function PreviewPanel({ lang }: { lang: 'en' | 'pt' }) {
  const labels =
    lang === 'pt'
      ? {
          headline: 'O que a equipa acompanha todos os dias',
          sub: 'A interface privilegia poucos sinais operacionais bem visíveis, em vez de um painel decorativo cheio de ruído.',
          rows: 'Rotina operacional',
          row1: 'Ver rupturas e excesso de stock sem sair do contexto do armazém',
          row2: 'Ligar ordens, movimentos e liquidações no mesmo fluxo',
          row3: 'Fechar o dia com margem, caixa e reconciliação no mesmo ecrã',
          signals: [
            {
              label: 'Stock visível',
              body: 'Quantidades, mínimos e valor ficam juntos para a leitura operacional e financeira.',
            },
            {
              label: 'Ordens em contexto',
              body: 'Compras, vendas e receção/expedição mantêm a mesma referência de trabalho.',
              tone: 'accent' as const,
            },
            {
              label: 'Caixa sob controlo',
              body: 'Recebimentos, pagamentos e bancos já não vivem em folhas separadas.',
            },
            {
              label: 'Margem confiável',
              body: 'Receita, CMVMC e valor de stock aparecem na mesma leitura de gestão.',
            },
          ] satisfies SurfaceSignal[],
        }
      : {
          headline: 'What teams keep in view every day',
          sub: 'The interface favors a few strong operational signals instead of a decorative dashboard full of noise.',
          rows: 'Operational rhythm',
          row1: 'See low stock and overstock without leaving warehouse context',
          row2: 'Keep orders, movements, and settlements tied to the same workflow',
          row3: 'Close the day with margin, cash, and reconciliation on one screen',
          signals: [
            {
              label: 'Visible stock',
              body: 'Quantities, minimums, and value stay together for operational and financial reading.',
            },
            {
              label: 'Orders in context',
              body: 'Purchases, sales, receiving, and shipping keep the same working reference.',
              tone: 'accent' as const,
            },
            {
              label: 'Cash under control',
              body: 'Cash receipts, payments, and banks no longer live in separate spreadsheets.',
            },
            {
              label: 'Trustworthy margin',
              body: 'Revenue, COGS, and inventory value sit in the same management view.',
            },
          ] satisfies SurfaceSignal[],
        }

  return (
    <Card className="overflow-hidden border-border/70 bg-card shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-border/70 bg-muted/35 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{labels.headline}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{labels.sub}</div>
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              StockWise
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2">
          {labels.signals.map((signal) => (
            <SurfaceSignalCard
              key={signal.label}
              label={signal.label}
              body={signal.body}
              tone={signal.tone}
            />
          ))}
        </div>

        <div className="border-t border-border/70 bg-muted/20 p-6">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{labels.rows}</div>
          <div className="mt-4 space-y-3">
            {[labels.row1, labels.row2, labels.row3].map((row) => (
              <div
                key={row}
                className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background px-4 py-3"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                <span className="text-sm leading-6">{row}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const { lang } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)

  const copy = copyByLang[lang]
  const ctaHref = user ? '/dashboard' : '/login'
  const signInHref = user ? '/dashboard' : '/login'
  const signInLabel = user ? 'Dashboard' : copy.signIn
  const primaryCtaLabel = user ? (lang === 'pt' ? 'Abrir dashboard' : 'Open dashboard') : copy.primaryCta
  const secondaryCtaLabel = user ? (lang === 'pt' ? 'Ir para a aplicação' : 'Go to app') : copy.secondaryCta

  const dashboardSignals = useMemo(
    () =>
      lang === 'pt'
        ? [
            ['Valor do Stock', 'Visível por armazém, com custo médio e alerta de reposição na mesma leitura.'],
            ['Receita 30d', 'Lida no mesmo período usado para CMVMC, margem e detalhe diário.'],
            ['CMVMC 30d', 'Ligado às saídas reais e não a um número solto sem rasto operacional.'],
            ['Margem Bruta', 'Interpretada com contexto de stock, expedição e liquidação.'],
            ['Armazéns', 'Operação multi-armazém com bins e movimentos rastreáveis.'],
            ['Ordens Abertas', 'Mantidas junto ao fluxo operacional, não perdidas em listas genéricas.'],
          ]
        : [
            ['Inventory Value', 'Visible by warehouse, with average cost and replenishment risk in the same reading.'],
            ['Revenue 30d', 'Read inside the same window used for COGS, margin, and daily detail.'],
            ['COGS 30d', 'Tied to real issue movements instead of a disconnected finance number.'],
            ['Gross Margin', 'Interpreted with stock, shipping, and settlement context still in view.'],
            ['Warehouses', 'Multi-warehouse operations with bins and traceable movements.'],
            ['Open Orders', 'Kept inside the operational workflow instead of generic lists.'],
          ],
    [lang]
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-x-0 top-0 -z-10 h-[360px] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_40%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),_transparent_24%)]" />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="min-w-0">
            <BrandLockup subtitle={copy.heroEyebrow} />
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">
            {copy.nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <LocaleToggle />
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to={signInHref}>{signInLabel}</Link>
            </Button>
            <Button asChild>
              <Link to={ctaHref}>{primaryCtaLabel}</Link>
            </Button>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <LocaleToggle />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t border-border/60 bg-background px-4 py-4 lg:hidden">
            <div className="flex flex-col gap-3">
              {copy.nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <Button variant="outline" asChild>
                <Link to={signInHref} onClick={() => setMenuOpen(false)}>
                  {signInLabel}
                </Link>
              </Button>
              <Button asChild>
                <Link to={ctaHref} onClick={() => setMenuOpen(false)}>
                  {primaryCtaLabel}
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <section id="product" className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
                <ShieldCheck className="mr-2 h-4 w-4" />
                {copy.heroEyebrow}
              </div>
              <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                {copy.heroTitle}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">{copy.heroBody}</p>
              <div className="mt-4 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-950 dark:bg-amber-500/15 dark:text-amber-100">
                <Languages className="mr-2 h-4 w-4" />
                {copy.heroSupport}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link to={ctaHref}>
                    {primaryCtaLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to={signInHref}>{secondaryCtaLabel}</Link>
                </Button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {[
                  lang === 'pt' ? 'Proteção real de rotas para páginas internas' : 'Real route protection for internal pages',
                  lang === 'pt' ? 'Estrutura bilingue EN/PT persistente' : 'Persistent EN/PT runtime language support',
                  lang === 'pt' ? 'Dashboard, stock, caixa e relatórios integrados' : 'Dashboard, stock, cash, and reporting aligned',
                  lang === 'pt' ? 'Experiência pública coerente com o produto' : 'Public experience aligned with the product itself',
                ].map((point) => (
                  <div key={point} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background p-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span className="text-sm text-muted-foreground">{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <PreviewPanel lang={lang} />
          </div>
        </section>

        <section className="border-y border-border/60 bg-muted/30 py-4">
          <div className="mx-auto max-w-7xl px-4 text-center text-sm font-medium text-foreground/80 sm:px-6 lg:px-8">
            {copy.valueStrip}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.featuresTitle}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{copy.featuresBody}</p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {copy.features.map((feature) => {
              const Icon = feature.icon
              return (
                <Card key={feature.title} className="border-border/70 bg-card shadow-sm transition-colors hover:border-primary/20">
                  <CardContent className="p-6">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold tracking-tight">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.body}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <section className="border-y border-border/60 bg-muted/40 py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.workflowTitle}</h2>
                <p className="mt-4 text-lg text-muted-foreground">{copy.workflowBody}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {copy.workflowSteps.map((step, index) => (
                  <div key={step} className="rounded-2xl border border-border/70 bg-background px-4 py-5">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {lang === 'pt' ? 'Etapa' : 'Step'} {index + 1}
                    </div>
                    <div className="mt-2 text-lg font-semibold">{step}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.kpiTitle}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{copy.kpiBody}</p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {dashboardSignals.map(([label, body], index) => (
              <SurfaceSignalCard
                key={label}
                label={label}
                body={body}
                tone={index === 1 || index === 3 ? 'accent' : 'default'}
              />
            ))}
          </div>
        </section>

        <section id="about" className="border-y border-border/60 bg-slate-950 py-16 text-white lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.aboutTitle}</h2>
              <p className="mt-4 text-lg text-slate-300">{copy.aboutBody}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {copy.aboutPoints.map((point) => (
                <div key={point} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <CheckCircle2 className="h-5 w-5 text-amber-300" />
                  <p className="mt-4 text-sm leading-6 text-slate-200">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="get-started" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.getStartedTitle}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{copy.getStartedBody}</p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {copy.plans.map((plan, index) => (
              <Card
                key={plan.title}
                className={cn(
                  'border-border/70 bg-card shadow-sm',
                  index === 1 ? 'border-primary/30 ring-1 ring-primary/15' : ''
                )}
              >
                <CardContent className="p-6">
                  <div className="text-sm font-semibold text-primary">{plan.title}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.body}</p>
                  <div className="mt-6 space-y-3">
                    {plan.points.map((point) => (
                      <div key={point} className="flex items-start gap-3 text-sm">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8 lg:pb-24">
          <Card className="overflow-hidden border-primary/15 bg-primary/[0.05] shadow-sm dark:border-primary/20 dark:bg-primary/[0.08]">
            <CardContent className="flex flex-col gap-6 p-8 lg:flex-row lg:items-center lg:justify-between lg:p-10">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.finalTitle}</h2>
                <p className="mt-4 text-lg text-muted-foreground">{copy.finalBody}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link to={ctaHref}>{copy.finalCta}</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to={signInHref}>{signInLabel}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border/60 bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
          <div className="max-w-sm">
            <BrandLockup subtitle={copy.footerTagline} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {copy.nav.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </a>
            ))}
            <Link to={signInHref} className="transition-colors hover:text-foreground">
              {signInLabel}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
