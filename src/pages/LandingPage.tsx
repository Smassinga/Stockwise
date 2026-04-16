import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  CreditCard,
  Languages,
  Menu,
  ShieldCheck,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import BrandLockup from '../components/brand/BrandLockup'
import LocaleToggle from '../components/LocaleToggle'
import ThemeToggle from '../components/ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../lib/i18n'
import { formatMzn, publicPricingPlans } from '../lib/pricingPlans'
import { cn } from '../lib/utils'

type Copy = {
  nav: Array<{ label: string; href: string }>
  heroEyebrow: string
  heroTitle: string
  heroBody: string
  heroSupport: string
  primaryCta: string
  secondaryCta: string
  trustPoints: string[]
  pricingTitle: string
  pricingBody: string
  pricingFootnote: string
  pricingEyebrow: string
  planLabels: {
    monthly: string
    sixMonth: string
    annual: string
    onboarding: string
    from: string
    highlight: string
  }
  operationsTitle: string
  operationsBody: string
  operationsPoints: Array<{ title: string; body: string }>
  rolloutTitle: string
  rolloutBody: string
  rolloutPoints: string[]
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
      { label: 'Pricing', href: '#pricing' },
      { label: 'Operations', href: '#operations' },
      { label: 'Rollout', href: '#rollout' },
    ],
    heroEyebrow: 'Operational control for stock, orders, settlements, and finance',
    heroTitle: 'Run stock and finance from one controlled workspace',
    heroBody:
      'StockWise brings inventory, sales, purchasing, settlement flow, cash, banks, and finance-document discipline into one operating system that teams can trust every day.',
    heroSupport:
      'Pricing is public in MZN. Trial starts for 7 days. Paid activation remains manually controlled by the StockWise team for now.',
    primaryCta: 'Start the 7-day trial',
    secondaryCta: 'Sign in',
    trustPoints: [
      '7-day trial starts when the first company is created',
      'Paid plans are manually activated after internal review',
      'Finance workflows stay locked behind approval and authority gates',
      'Portuguese and English runtime support remain aligned',
    ],
    pricingTitle: 'Clear MZN pricing without fake checkout flow',
    pricingBody:
      'Commercial positioning is public, but paid access stays manually granted in this phase so implementation, support, and rollout discipline remain controlled.',
    pricingFootnote:
      'No automatic payment collection is active yet. The control plane is being built so automation can be added later without redesigning tenant access.',
    pricingEyebrow: 'Pricing in MZN',
    planLabels: {
      monthly: 'Monthly',
      sixMonth: '6 months',
      annual: 'Yearly',
      onboarding: 'Onboarding',
      from: 'From',
      highlight: 'Most adopted',
    },
    operationsTitle: 'Built for the work teams actually do',
    operationsBody:
      'StockWise is not a decorative dashboard. It is the operating surface for goods, liabilities, receivables, and daily control.',
    operationsPoints: [
      {
        title: 'Warehouse and stock discipline',
        body: 'Keep items, bins, assemblies, and stock movements tied to the same operational picture.',
      },
      {
        title: 'Sales and purchasing in one chain',
        body: 'Move cleanly from Sales Orders to Sales Invoices and from Purchase Orders to Vendor Bills without losing context.',
      },
      {
        title: 'Cash, bank, and reconciliation visibility',
        body: 'See receipts, payments, settlements, and legal outstanding positions in the same system.',
      },
    ],
    rolloutTitle: 'Controlled rollout instead of accidental drift',
    rolloutBody:
      'The current commercial model is deliberate: trial access is enforced, paid access is granted manually, and operational data can be scheduled for purge without deleting user credentials.',
    rolloutPoints: [
      'User credentials remain intact after trial expiry',
      'Tenant access can be trial, active paid, expired, suspended, or disabled',
      'Manual grant and revoke actions are audited',
      'Future payment automation can plug into the same control plane later',
    ],
    finalTitle: 'Move from scattered tracking to disciplined execution',
    finalBody:
      'If the team needs stock, orders, banks, cash, and finance documents to reconcile in one place, start with the 7-day trial and keep the commercial activation controlled.',
    finalCta: 'Open StockWise',
    signIn: 'Sign in',
    footerTagline: 'Inventory, operations, settlements, and finance control in one system.',
  },
  pt: {
    nav: [
      { label: 'Produto', href: '#product' },
      { label: 'Preços', href: '#pricing' },
      { label: 'Operação', href: '#operations' },
      { label: 'Implementação', href: '#rollout' },
    ],
    heroEyebrow: 'Controlo operacional para stock, encomendas, liquidações e finanças',
    heroTitle: 'Controle stock e finanças a partir de um único workspace',
    heroBody:
      'O StockWise junta inventário, vendas, compras, liquidações, caixa, bancos e disciplina documental financeira num sistema operacional em que a equipa pode confiar todos os dias.',
    heroSupport:
      'Os preços são públicos em MZN. O teste dura 7 dias. A ativação paga continua manual pela equipa StockWise nesta fase.',
    primaryCta: 'Iniciar o teste de 7 dias',
    secondaryCta: 'Iniciar sessão',
    trustPoints: [
      'O teste de 7 dias começa quando a primeira empresa é criada',
      'Os planos pagos continuam a ser ativados manualmente após revisão interna',
      'Os fluxos financeiros continuam protegidos por aprovação e autoridade',
      'O suporte em português e inglês mantém-se alinhado no runtime',
    ],
    pricingTitle: 'Preços claros em MZN, sem checkout falso',
    pricingBody:
      'O posicionamento comercial é público, mas o acesso pago continua a ser concedido manualmente nesta fase para manter controlo de implementação, suporte e rollout.',
    pricingFootnote:
      'Ainda não existe cobrança automática. O controlo de acesso está a ser estruturado para que a automação entre mais tarde sem redesenhar o modelo do tenant.',
    pricingEyebrow: 'Preços em MZN',
    planLabels: {
      monthly: 'Mensal',
      sixMonth: '6 meses',
      annual: 'Anual',
      onboarding: 'Onboarding',
      from: 'Desde',
      highlight: 'Plano mais adotado',
    },
    operationsTitle: 'Feito para o trabalho que a equipa realmente faz',
    operationsBody:
      'O StockWise não é um dashboard decorativo. É a superfície operacional para mercadoria, passivos, recebíveis e controlo diário.',
    operationsPoints: [
      {
        title: 'Disciplina de armazém e stock',
        body: 'Mantenha artigos, bins, montagens e movimentos de stock na mesma leitura operacional.',
      },
      {
        title: 'Vendas e compras na mesma cadeia',
        body: 'Passe de Encomendas de Venda para Faturas e de Ordens de Compra para Vendor Bills sem perder contexto.',
      },
      {
        title: 'Visibilidade de caixa, banco e reconciliação',
        body: 'Veja recebimentos, pagamentos, liquidações e posições legais em aberto no mesmo sistema.',
      },
    ],
    rolloutTitle: 'Implementação controlada em vez de deriva acidental',
    rolloutBody:
      'O modelo comercial atual é deliberado: o teste é aplicado com disciplina, o acesso pago é concedido manualmente e os dados operacionais podem ser agendados para purga sem apagar as credenciais do utilizador.',
    rolloutPoints: [
      'As credenciais do utilizador mantêm-se após a expiração do teste',
      'O acesso do tenant pode estar em trial, active paid, expired, suspended ou disabled',
      'As ações manuais de concessão e revogação ficam auditadas',
      'A futura automação de pagamentos pode encaixar no mesmo controlo de acesso',
    ],
    finalTitle: 'Passe de controlo disperso para execução disciplinada',
    finalBody:
      'Se a equipa precisa que stock, encomendas, bancos, caixa e documentos financeiros reconciliem no mesmo lugar, comece pelo teste de 7 dias e mantenha a ativação comercial sob controlo.',
    finalCta: 'Abrir StockWise',
    signIn: 'Iniciar sessão',
    footerTagline: 'Inventário, operação, liquidações e controlo financeiro no mesmo sistema.',
  },
}

const planTaglinesByLang: Record<'en' | 'pt', Record<string, string>> = {
  en: {
    starter: 'Core stock, orders, and daily finance visibility for a focused operating team.',
    growth: 'For teams expanding workflow control across more locations, users, and finance volume.',
    business: 'For finance-heavy operations that need tighter execution discipline and broader control.',
    managed_business_plus: 'High-touch rollout, operational oversight, and managed enablement for larger deployments.',
  },
  pt: {
    starter: 'Stock, encomendas e visibilidade financeira diária para uma equipa operacional focada.',
    growth: 'Para equipas a expandir controlo de workflow por mais locais, utilizadores e volume financeiro.',
    business: 'Para operações com maior peso financeiro que exigem disciplina mais forte e controlo mais amplo.',
    managed_business_plus: 'Implementação assistida, supervisão operacional e acompanhamento gerido para operações maiores.',
  },
}

function PricingCard({
  plan,
  lang,
  labels,
}: {
  plan: (typeof publicPricingPlans)[number]
  lang: 'en' | 'pt'
  labels: Copy['planLabels']
}) {
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const tagline = planTaglinesByLang[lang][plan.code] || plan.tagline

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border/70 bg-card shadow-[0_26px_80px_-56px_rgba(15,23,42,0.45)]',
        plan.highlight ? 'border-primary/35 ring-1 ring-primary/10' : '',
      )}
    >
      {plan.highlight ? (
        <div className="absolute right-4 top-4 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {labels.highlight}
        </div>
      ) : null}
      <CardHeader className="space-y-3 border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.04]">
        <div className="text-sm font-semibold text-foreground">{plan.name}</div>
        <CardDescription className="min-h-[72px] text-sm leading-6 text-muted-foreground">{tagline}</CardDescription>
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {plan.startingAnnualMzn ? labels.from : labels.annual}
          </div>
          <div className="text-3xl font-semibold tracking-tight">
            {formatMzn(plan.startingAnnualMzn ?? plan.annualMzn, locale)}
          </div>
          <div className="text-sm text-muted-foreground">{labels.annual}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {plan.monthlyMzn ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {labels.monthly}
              </div>
              <div className="mt-2 text-lg font-semibold">{formatMzn(plan.monthlyMzn, locale)}</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {labels.sixMonth}
              </div>
              <div className="mt-2 text-lg font-semibold">{formatMzn(plan.sixMonthMzn, locale)}</div>
            </div>
          </div>
        ) : null}
        {plan.onboardingMzn ? (
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {labels.onboarding}
            </div>
            <div className="mt-2 text-lg font-semibold">{formatMzn(plan.onboardingMzn, locale)}</div>
          </div>
        ) : null}
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
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'

  const heroSignals = useMemo(
    () => [
      {
        icon: Warehouse,
        title: lang === 'pt' ? 'Stock operacional' : 'Operational stock',
        body:
          lang === 'pt'
            ? 'Armazéns, bins, níveis de stock e montagem no mesmo fluxo de execução.'
            : 'Warehouses, bins, stock levels, and assembly kept inside the same execution flow.',
      },
      {
        icon: CreditCard,
        title: lang === 'pt' ? 'Documentos financeiros' : 'Finance documents',
        body:
          lang === 'pt'
            ? 'Faturas, Vendor Bills, liquidações e reconciliação com disciplina documental.'
            : 'Invoices, Vendor Bills, settlements, and reconciliation with document discipline.',
      },
      {
        icon: Wallet,
        title: lang === 'pt' ? 'Caixa e banco' : 'Cash and bank',
        body:
          lang === 'pt'
            ? 'Recebimentos, pagamentos e controlo operacional de caixa e banco sem folhas paralelas.'
            : 'Receipts, payments, and operating control over cash and bank without parallel spreadsheets.',
      },
    ],
    [lang],
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
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
          <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
                <ShieldCheck className="mr-2 h-4 w-4" />
                {copy.heroEyebrow}
              </div>
              <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                {copy.heroTitle}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">{copy.heroBody}</p>
              <div className="mt-4 inline-flex max-w-xl items-center rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <Languages className="mr-2 h-4 w-4 shrink-0" />
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
                {copy.trustPoints.map((point) => (
                  <div key={point} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background p-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span className="text-sm text-muted-foreground">{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <Card className="overflow-hidden border-border/70 bg-card shadow-[0_32px_90px_-60px_rgba(15,23,42,0.5)]">
              <CardHeader className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05]">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  {lang === 'pt' ? 'Modelo comercial atual' : 'Current commercial model'}
                </div>
                <CardTitle className="mt-4 text-2xl tracking-tight">
                  {lang === 'pt' ? 'Teste primeiro. Ative pago depois.' : 'Trial first. Paid activation after.'}
                </CardTitle>
                <CardDescription className="text-base leading-7">
                  {lang === 'pt'
                    ? 'O produto já mostra o posicionamento de preço publicamente, mas o acesso pago continua sob controlo manual interno nesta fase.'
                    : 'The product now shows pricing publicly, but paid access remains under internal manual control in this phase.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 p-6">
                {heroSignals.map((signal) => {
                  const Icon = signal.icon
                  return (
                    <div key={signal.title} className="rounded-2xl border border-border/70 bg-background p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-muted/20 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="text-base font-semibold">{signal.title}</div>
                      </div>
                      <div className="mt-3 text-sm leading-6 text-muted-foreground">{signal.body}</div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="pricing" className="border-y border-border/60 bg-muted/35 py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <BadgeDollarSign className="mr-2 h-4 w-4" />
                {copy.pricingEyebrow}
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.pricingTitle}</h2>
              <p className="mt-4 text-lg text-muted-foreground">{copy.pricingBody}</p>
            </div>

            <div className="mt-10 grid gap-5 xl:grid-cols-4">
              {publicPricingPlans.map((plan) => (
                <PricingCard key={plan.code} plan={plan} lang={lang} labels={copy.planLabels} />
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-border/70 bg-background px-5 py-4 text-sm leading-6 text-muted-foreground">
              {copy.pricingFootnote}
            </div>
          </div>
        </section>

        <section id="operations" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.operationsTitle}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{copy.operationsBody}</p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {copy.operationsPoints.map((point) => (
              <Card key={point.title} className="border-border/70 bg-card shadow-[0_20px_70px_-54px_rgba(15,23,42,0.45)]">
                <CardContent className="p-6">
                  <div className="text-xl font-semibold tracking-tight">{point.title}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{point.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="rollout" className="border-y border-border/60 bg-muted/20 py-16 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.rolloutTitle}</h2>
              <p className="mt-4 text-lg text-muted-foreground">{copy.rolloutBody}</p>
            </div>
            <div className="grid gap-3">
              {copy.rolloutPoints.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background px-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span className="text-sm leading-6 text-muted-foreground">{point}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <Card className="overflow-hidden border-primary/15 bg-primary/[0.05] shadow-[0_28px_90px_-60px_rgba(15,23,42,0.52)] dark:border-primary/20 dark:bg-primary/[0.08]">
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
            <span>{formatMzn(publicPricingPlans[0]?.monthlyMzn, locale)}+</span>
            <Link to={signInHref} className="transition-colors hover:text-foreground">
              {signInLabel}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
