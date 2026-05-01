import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  Clock3,
  Handshake,
  LifeBuoy,
  Menu,
  ShieldCheck,
  Sparkles,
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
import { buildPublicMailto } from '../lib/publicContact'
import { cn } from '../lib/utils'

type Copy = {
  nav: Array<{ label: string; href: string }>
  heroEyebrow: string
  heroTitle: string
  heroBody: string
  heroSupport: string
  primaryCta: string
  secondaryCta: string
  tertiaryCta: string
  trustPoints: string[]
  pricingEyebrow: string
  pricingTitle: string
  pricingBody: string
  pricingFootnote: string
  operationsTitle: string
  operationsBody: string
  operationsPoints: Array<{ title: string; body: string; icon: 'stock' | 'finance' | 'support' }>
  rolloutTitle: string
  rolloutBody: string
  rolloutSteps: Array<{ title: string; body: string }>
  finalTitle: string
  finalBody: string
  finalPrimary: string
  finalSecondary: string
  signIn: string
  footerTagline: string
  labels: {
    monthly: string
    sixMonth: string
    annual: string
    onboarding: string
    annualSaving: string
    recommended: string
    selected: string
    from: string
    includes: string
    support: string
    bestFor: string
    company: string
    users: string
    requestActivation: string
    bookDemo: string
    talkToUs: string
    trial: string
  }
  managedPricingNoteTitle: string
  managedPricingNoteBody: string
}

type PlanContent = {
  headline: string
  bestFor: string
  included: string[]
  support: string[]
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    nav: [
      { label: 'Product', href: '#product' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Rollout', href: '#rollout' },
    ],
    heroEyebrow: 'Stock, orders, settlements, and finance in one disciplined workspace',
    heroTitle: 'Operational control for businesses that cannot afford drift',
    heroBody:
      'StockWise connects inventory, purchasing, sales, cash, banks, settlements, and finance-document discipline so teams can run daily operations from one trusted system.',
    heroSupport:
      'Public pricing is shown in MZN. Every new company starts with a 7-day trial. Paid access is still activated manually by the StockWise team.',
    primaryCta: 'Start 7-day trial',
    secondaryCta: 'Book a demo',
    tertiaryCta: 'Request activation',
    trustPoints: [
      '7-day trial starts when the first company is created',
      'Manual activation keeps rollout, onboarding, and support under control',
      'Finance workflows stay protected by approval, authority, and issue/post discipline',
      'Portuguese and English remain aligned across public and operational screens',
    ],
    pricingEyebrow: 'Commercial plans',
    pricingTitle: 'Pricing',
    pricingBody:
      'Choose the operational depth and support level that fits the business. Prices are public in MZN, while paid access continues to be granted manually in this phase.',
    pricingFootnote:
      'Automatic checkout is not active. Trial access, activation, and rollout are still handled directly by the StockWise team.',
    operationsTitle: 'What StockWise covers',
    operationsBody:
      'The platform is built for real operating control: the stock you hold, the orders you confirm, the liabilities you owe, and the balances you still need to collect.',
    operationsPoints: [
      {
        title: 'Inventory and warehouse discipline',
        body: 'Items, warehouses, bins, movements, landed cost, and assembly stay inside the same operational picture.',
        icon: 'stock',
      },
      {
        title: 'Sales, purchasing, and finance continuity',
        body: 'Move cleanly from Sales Orders to Sales Invoices and from Purchase Orders to Vendor Bills without losing the legal finance anchor.',
        icon: 'finance',
      },
      {
        title: 'Supportable rollout',
        body: 'Trial access is real, pricing is public, and activation remains deliberate so implementation quality does not drift.',
        icon: 'support',
      },
    ],
    rolloutTitle: 'How rollout works right now',
    rolloutBody:
      'The current commercial model is intentional. It gives teams a clear trial path, keeps entitlements auditable, and avoids fake checkout flows before payment automation is ready.',
    rolloutSteps: [
      {
        title: 'Start the 7-day trial',
        body: 'Create the first company, start the operational trial, and set up the workspace with your own users, stock, customers, and suppliers.',
      },
      {
        title: 'Review the right plan',
        body: 'Use the pricing table to compare user limits, onboarding depth, reporting visibility, and support posture in MZN.',
      },
      {
        title: 'Request manual activation',
        body: 'When the team is ready, StockWise manually grants paid access through the control plane so rollout stays commercially and operationally controlled.',
      },
    ],
    finalTitle: 'Ready to move beyond spreadsheets and fragmented follow-up?',
    finalBody:
      'Start with the 7-day trial, book a demo, or request activation for a live workspace. The product is ready for serious operations even though payment automation is intentionally deferred.',
    finalPrimary: 'Open StockWise',
    finalSecondary: 'Talk to us',
    signIn: 'Sign in',
    footerTagline: 'Inventory, operations, settlements, and finance control in one system.',
    labels: {
      monthly: 'Monthly',
      sixMonth: '6 months',
      annual: 'Annual',
      onboarding: 'Onboarding',
      annualSaving: 'Annual saving',
      recommended: 'Recommended',
      selected: 'Selected',
      from: 'From',
      includes: 'What is included',
      support: 'Implementation and support',
      bestFor: 'Best for',
      company: 'Company account',
      users: 'Users',
      requestActivation: 'Request activation',
      bookDemo: 'Book a demo',
      talkToUs: 'Talk to us',
      trial: '7-day trial',
    },
    managedPricingNoteTitle: 'Managed engagement',
    managedPricingNoteBody:
      'Pricing stays anchored to the annual engagement. Onboarding depth, refresher sessions, and rollout handling are scoped directly with the StockWise team.',
  },
  pt: {
    nav: [
      { label: 'Produto', href: '#product' },
      { label: 'Preços', href: '#pricing' },
      { label: 'Implementação', href: '#rollout' },
    ],
    heroEyebrow: 'Stock, encomendas, liquidações e finanças no mesmo workspace disciplinado',
    heroTitle: 'Controlo operacional para empresas que não podem trabalhar à deriva',
    heroBody:
      'O StockWise liga inventário, compras, vendas, caixa, bancos, liquidações e disciplina documental financeira para que a equipa opere a partir de um único sistema de confiança.',
    heroSupport:
      'Os preços públicos estão em MZN. Cada nova empresa começa com um teste de 7 dias. O acesso pago continua a ser ativado manualmente pela equipa StockWise.',
    primaryCta: 'Iniciar teste de 7 dias',
    secondaryCta: 'Marcar demonstração',
    tertiaryCta: 'Pedir ativação',
    trustPoints: [
      'O teste de 7 dias começa quando a primeira empresa é criada',
      'A ativação manual mantém rollout, onboarding e suporte sob controlo',
      'Os fluxos financeiros continuam protegidos por aprovação, autoridade e disciplina de emissão e lançamento',
      'Português e inglês mantêm-se alinhados entre ecrãs públicos e operacionais',
    ],
    pricingEyebrow: 'Planos comerciais',
    pricingTitle: 'Preços',
    pricingBody:
      'Escolha o nível de controlo operacional e suporte que faz sentido para o negócio. Os valores são públicos em MZN, enquanto o acesso pago continua a ser concedido manualmente nesta fase.',
    pricingFootnote:
      'O checkout automático ainda não está ativo. O teste, a ativação e o rollout continuam a ser tratados diretamente pela equipa StockWise.',
    operationsTitle: 'O que o StockWise cobre',
    operationsBody:
      'A plataforma foi feita para controlo operacional real: o stock que mantém, as encomendas que confirma, os passivos que precisa pagar e os saldos que ainda precisa cobrar.',
    operationsPoints: [
      {
        title: 'Disciplina de inventário e armazém',
        body: 'Artigos, armazéns, bins, movimentos, landed cost e montagem ficam dentro da mesma leitura operacional.',
        icon: 'stock',
      },
      {
        title: 'Continuidade entre vendas, compras e finanças',
        body: 'Passe de Encomendas de Venda para Faturas e de Ordens de Compra para Vendor Bills sem perder a âncora financeira legal.',
        icon: 'finance',
      },
      {
        title: 'Implementação com controlo',
        body: 'O teste é real, os preços são públicos e a ativação continua deliberada para que a qualidade da implementação não se perca.',
        icon: 'support',
      },
    ],
    rolloutTitle: 'Como funciona a implementação nesta fase',
    rolloutBody:
      'O modelo comercial atual é intencional. Dá à equipa um caminho claro de teste, mantém os acessos auditáveis e evita fluxos falsos de checkout antes da automação de pagamentos estar pronta.',
    rolloutSteps: [
      {
        title: 'Inicie o teste de 7 dias',
        body: 'Crie a primeira empresa, arranque o teste operacional e configure o workspace com os seus utilizadores, stock, clientes e fornecedores.',
      },
      {
        title: 'Reveja o plano certo',
        body: 'Use a tabela de preços para comparar limites de utilizadores, profundidade de onboarding, visibilidade de reporting e postura de suporte em MZN.',
      },
      {
        title: 'Peça a ativação manual',
        body: 'Quando a equipa estiver pronta, a StockWise concede o acesso pago manualmente através do controlo de plataforma para manter o rollout comercial e operacional sob controlo.',
      },
    ],
    finalTitle: 'Pronto para sair de folhas soltas e controlo fragmentado?',
    finalBody:
      'Comece com o teste de 7 dias, marque uma demonstração ou peça a ativação para um workspace real. O produto está pronto para operações sérias, mesmo com a automação de pagamentos ainda adiada.',
    finalPrimary: 'Abrir StockWise',
    finalSecondary: 'Falar connosco',
    signIn: 'Iniciar sessão',
    footerTagline: 'Inventário, operação, liquidações e controlo financeiro no mesmo sistema.',
    labels: {
      monthly: 'Mensal',
      sixMonth: '6 meses',
      annual: 'Anual',
      onboarding: 'Onboarding',
      annualSaving: 'Poupança anual',
      recommended: 'Recomendado',
      selected: 'Selecionado',
      from: 'Desde',
      includes: 'O que inclui',
      support: 'Implementação e suporte',
      bestFor: 'Mais indicado para',
      company: 'Conta da empresa',
      users: 'Utilizadores',
      requestActivation: 'Pedir ativação',
      bookDemo: 'Marcar demonstração',
      talkToUs: 'Falar connosco',
      trial: 'Teste de 7 dias',
    },
    managedPricingNoteTitle: 'Engajamento gerido',
    managedPricingNoteBody:
      'O preço base continua ancorado ao compromisso anual. A profundidade do onboarding, as formações de reforço e o ritmo do rollout são definidos diretamente com a equipa StockWise.',
  },
}
const planContentByLang: Record<'en' | 'pt', Record<string, PlanContent>> = {
  en: {
    starter: {
      headline: 'Clean operational control for smaller teams.',
      bestFor: 'A business that needs one company account, up to two users, and a disciplined stock-and-order baseline.',
      included: [
        '1 company account',
        'Up to 2 users',
        'Product and stock management',
        'Sales order management',
        'Purchase order management',
        'Customer and supplier records',
        'Basic dashboards and reporting',
      ],
      support: [
        'Initial setup support',
        'Up to 1 week of remote user training',
        'Standard remote support during business hours',
      ],
    },
    growth: {
      headline: 'The most balanced plan for growing teams.',
      bestFor: 'A company that needs stronger visibility, more users, and better operational follow-up without moving into a managed engagement.',
      included: [
        'Includes everything in Starter',
        'Up to 5 users',
        'Enhanced reporting and dashboard visibility',
        'Improved follow-up on customer balances and operational activity',
      ],
      support: [
        'Priority remote support',
        'Up to 2 weeks of remote user training',
        'Additional setup guidance during implementation',
      ],
    },
    business: {
      headline: 'For heavier daily operations that need tighter handling.',
      bestFor: 'An established team with more users, more follow-up needs, and more complex day-to-day execution.',
      included: [
        'Includes everything in Growth',
        'Up to 10 users',
        'Better fit for more complex daily operations',
      ],
      support: [
        'Faster support handling',
        'More hands-on onboarding support',
        'Periodic review and guidance during adoption',
      ],
    },
    managed_business_plus: {
      headline: 'A higher-touch operating relationship.',
      bestFor: 'A business that wants the Business plan plus more direct rollout support, refresher training, and periodic operational guidance.',
      included: [
        'Business plan access',
        'Premium onboarding approach',
        'Refresher training sessions',
      ],
      support: [
        'Periodic review meetings',
        'Higher support priority',
        'More hands-on assistance during adoption and stabilisation',
      ],
    },
  },
  pt: {
    starter: {
      headline: 'Controlo operacional limpo para equipas menores.',
      bestFor: 'Um negócio que precisa de uma conta de empresa, até dois utilizadores e uma base disciplinada de stock e encomendas.',
      included: [
        '1 conta de empresa',
        'Até 2 utilizadores',
        'Gestão de produtos e stock',
        'Gestão de encomendas de venda',
        'Gestão de ordens de compra',
        'Registos de clientes e fornecedores',
        'Dashboards e reporting base',
      ],
      support: [
        'Suporte inicial de configuração',
        'Até 1 semana de formação remota de utilizadores',
        'Suporte remoto padrão durante o horário de trabalho',
      ],
    },
    growth: {
      headline: 'O plano mais equilibrado para equipas em crescimento.',
      bestFor: 'Uma empresa que precisa de mais visibilidade, mais utilizadores e melhor acompanhamento operacional sem entrar ainda num modelo gerido.',
      included: [
        'Inclui tudo do Starter',
        'Até 5 utilizadores',
        'Reporting e dashboards mais completos',
        'Melhor acompanhamento de saldos de clientes e atividade operacional',
      ],
      support: [
        'Suporte remoto prioritário',
        'Até 2 semanas de formação remota de utilizadores',
        'Orientação adicional durante a implementação',
      ],
    },
    business: {
      headline: 'Para operações mais exigentes no dia a dia.',
      bestFor: 'Uma equipa estabelecida com mais utilizadores, mais necessidade de acompanhamento e operação diária mais complexa.',
      included: [
        'Inclui tudo do Growth',
        'Até 10 utilizadores',
        'Melhor ajuste para operações diárias mais complexas',
      ],
      support: [
        'Tratamento de suporte mais rápido',
        'Onboarding mais acompanhado',
        'Revisões periódicas e orientação durante a adoção',
      ],
    },
    managed_business_plus: {
      headline: 'Uma relação mais acompanhada e mais próxima.',
      bestFor: 'Um negócio que quer o plano Business com mais apoio de rollout, formação de reforço e orientação operacional periódica.',
      included: [
        'Acesso ao plano Business',
        'Abordagem premium de onboarding',
        'Sessões de formação de reforço',
      ],
      support: [
        'Reuniões periódicas de revisão',
        'Prioridade de suporte mais alta',
        'Apoio mais próximo durante adoção e estabilização',
      ],
    },
  },
}

function operationIcon(name: 'stock' | 'finance' | 'support') {
  if (name === 'stock') return Warehouse
  if (name === 'finance') return Wallet
  return LifeBuoy
}

const defaultPricingPlanCode = publicPricingPlans.find((plan) => plan.highlight)?.code ?? publicPricingPlans[0]?.code ?? ''

function PricingCard({
  plan,
  content,
  copy,
  locale,
  trialHref,
  demoHref,
  activationHref,
  selected,
  onSelect,
}: {
  plan: (typeof publicPricingPlans)[number]
  content: PlanContent
  copy: Copy
  locale: string
  trialHref: string
  demoHref: string
  activationHref: string
  selected: boolean
  onSelect: () => void
}) {
  const managed = plan.code === 'managed_business_plus'

  return (
    <Card
      data-pricing-plan={plan.code}
      data-selected={selected ? 'true' : 'false'}
      onMouseEnter={onSelect}
      onFocusCapture={onSelect}
      className={cn(
        'group relative flex h-full cursor-pointer flex-col overflow-hidden border-border/70 bg-card shadow-[0_28px_90px_-60px_rgba(15,23,42,0.48)] transition-[transform,border-color,box-shadow,background-color] duration-200 ease-out hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_36px_110px_-60px_rgba(15,23,42,0.56)] focus-within:-translate-y-1 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 dark:hover:border-primary/50',
        selected ? 'border-primary/50 bg-gradient-to-b from-primary/[0.055] via-card to-card shadow-[0_38px_110px_-58px_rgba(37,99,235,0.28)] dark:from-primary/10' : '',
        plan.highlight ? 'ring-1 ring-amber-300/50 dark:ring-amber-300/25' : '',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent transition-opacity duration-200',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      />
      <CardHeader className="grid gap-4 border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.04] p-5 sm:p-6">
        <div className="min-h-[1.8rem]">
          <div className="flex flex-wrap gap-2">
            {selected ? (
              <span className="inline-flex rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary dark:border-sky-300/50 dark:bg-sky-300/20 dark:text-sky-100">
                {copy.labels.selected}
              </span>
            ) : null}
            {plan.highlight ? (
              <span className="inline-flex rounded-full border border-amber-300/60 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800 dark:border-amber-300/50 dark:bg-amber-300/20 dark:text-amber-100">
                {copy.labels.recommended}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-2 2xl:min-h-[7.25rem]">
          <CardTitle className="text-2xl tracking-tight">{plan.name}</CardTitle>
          <CardDescription className="text-sm leading-6 text-muted-foreground">{content.headline}</CardDescription>
        </div>

        <div className="grid content-start gap-3 sm:grid-cols-2 2xl:min-h-[6.5rem]">
          <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.labels.company}
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{plan.companyAccountLabel || '-'}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.labels.users}
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{plan.userLimitLabel || '-'}</div>
          </div>
        </div>

        <div className="flex min-h-[10.5rem] flex-col justify-between rounded-2xl border border-border/70 bg-background px-4 py-4 2xl:min-h-[11.25rem]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {managed ? copy.labels.from : copy.labels.annual}
          </div>
          <div>
            <div className="mt-2 text-[1.8rem] font-semibold tracking-tight sm:text-[2rem] 2xl:text-[2.2rem]">
              {formatMzn(plan.startingAnnualMzn ?? plan.annualMzn, locale)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{copy.labels.annual}</div>
          </div>
          <div className="pt-3">
            {plan.annualSavingMzn ? (
              <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-300/20 dark:text-emerald-100">
                {copy.labels.annualSaving}: {formatMzn(plan.annualSavingMzn, locale)}
              </div>
            ) : (
              <div className="h-7" aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="grid content-start gap-3 sm:grid-cols-2 2xl:min-h-[13rem]">
          {!managed ? (
            <>
              <div className="min-h-[6.25rem] rounded-2xl border border-border/70 bg-background px-4 py-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.labels.monthly}
                </div>
                <div className="mt-2 text-[1.02rem] font-semibold leading-tight sm:text-[1.1rem]">
                  {formatMzn(plan.monthlyMzn, locale)}
                </div>
              </div>
              <div className="min-h-[6.25rem] rounded-2xl border border-border/70 bg-background px-4 py-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.labels.sixMonth}
                </div>
                <div className="mt-2 text-[1.02rem] font-semibold leading-tight sm:text-[1.1rem]">
                  {formatMzn(plan.sixMonthMzn, locale)}
                </div>
              </div>
              <div className="min-h-[6.75rem] rounded-2xl border border-border/70 bg-background px-4 py-3.5 sm:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.labels.onboarding}
                </div>
                <div className="mt-2 text-[1.02rem] font-semibold leading-tight sm:text-[1.1rem]">
                  {formatMzn(plan.onboardingMzn, locale)}
                </div>
              </div>
            </>
          ) : (
            <div className="min-h-[13.75rem] rounded-2xl border border-border/70 bg-background px-4 py-3.5 sm:col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {copy.managedPricingNoteTitle}
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">{copy.managedPricingNoteBody}</div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-6 p-6">
        <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {copy.labels.bestFor}
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">{content.bestFor}</div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.labels.includes}
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {content.included.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.labels.support}
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {content.support.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary dark:text-sky-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-auto grid gap-3 pt-2">
          <Button asChild>
            {managed ? (
              <a href={demoHref}>{copy.labels.talkToUs}</a>
            ) : (
              <Link to={trialHref}>{copy.labels.trial}</Link>
            )}
          </Button>
          <Button variant="outline" asChild>
            <a href={activationHref}>{managed ? copy.labels.bookDemo : copy.labels.requestActivation}</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const { lang } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedPlanCode, setSelectedPlanCode] = useState(defaultPricingPlanCode)

  const copy = copyByLang[lang]
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const ctaHref = user ? '/dashboard' : '/login'
  const signInHref = user ? '/dashboard' : '/login'
  const signInLabel = user ? 'Dashboard' : copy.signIn
  const primaryCtaLabel = user ? (lang === 'pt' ? 'Abrir dashboard' : 'Open dashboard') : copy.primaryCta
  const demoHref = buildPublicMailto(lang === 'pt' ? 'Pedido de demonstração StockWise' : 'StockWise demo request')
  const activationHref = buildPublicMailto(lang === 'pt' ? 'Pedido de ativação StockWise' : 'StockWise activation request')
  const talkHref = buildPublicMailto(lang === 'pt' ? 'Contacto comercial StockWise' : 'StockWise commercial contact')

  const operationSignals = useMemo(
    () =>
      copy.operationsPoints.map((item) => ({
        ...item,
        icon: operationIcon(item.icon),
      })),
    [copy.operationsPoints],
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="min-w-0">
            <BrandLockup compact />
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
                <Clock3 className="mr-2 h-4 w-4 shrink-0" />
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
                  <a href={demoHref}>{copy.secondaryCta}</a>
                </Button>
                <Button size="lg" variant="ghost" asChild>
                  <a href={activationHref}>{copy.tertiaryCta}</a>
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
                  <Sparkles className="h-3.5 w-3.5" />
                  {lang === 'pt' ? 'Modelo comercial atual' : 'Current commercial model'}
                </div>
                <CardTitle className="mt-4 text-2xl tracking-tight">
                  {lang === 'pt' ? 'Teste primeiro. Ative depois.' : 'Trial first. Activation after.'}
                </CardTitle>
                <CardDescription className="text-base leading-7">
                  {lang === 'pt'
                    ? 'Os preços estão públicos, mas a ativação paga continua manual. Isso mantém implementação, suporte e rollout sob controlo enquanto o produto cresce.'
                    : 'Pricing is public, but paid activation remains manual. That keeps implementation, support, and rollout under control while the product grows.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 p-6">
                {[
                  {
                    icon: Building2,
                    title: lang === 'pt' ? 'Configuração operacional' : 'Operational setup',
                    body:
                      lang === 'pt'
                        ? 'Monte a empresa, os utilizadores, os artigos, os armazéns e os fluxos principais durante o teste.'
                        : 'Set up the company, users, items, warehouses, and core flows during the trial.',
                  },
                  {
                    icon: BadgeDollarSign,
                    title: lang === 'pt' ? 'Planos claros em MZN' : 'Clear MZN plans',
                    body:
                      lang === 'pt'
                        ? 'Mensal, 6 meses, anual e onboarding estão explícitos para cada pacote, sem checkout falso.'
                        : 'Monthly, 6-month, annual, and onboarding figures are explicit for each package, without fake checkout.',
                  },
                  {
                    icon: Handshake,
                    title: lang === 'pt' ? 'Ativação controlada' : 'Controlled activation',
                    body:
                      lang === 'pt'
                        ? 'Quando a equipa estiver pronta, a ativação é feita manualmente pela StockWise com registo no controlo de plataforma.'
                        : 'When the team is ready, activation is handled manually by StockWise and recorded in platform control.',
                  },
                ].map((signal) => {
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
          <div className="mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <BadgeDollarSign className="mr-2 h-4 w-4" />
                {copy.pricingEyebrow}
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.pricingTitle}</h2>
              <p className="mt-4 text-lg text-muted-foreground">{copy.pricingBody}</p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {publicPricingPlans.map((plan) => (
                <PricingCard
                  key={plan.code}
                  plan={plan}
                  content={planContentByLang[lang][plan.code]}
                  copy={copy}
                  locale={locale}
                  trialHref={ctaHref}
                  demoHref={demoHref}
                  activationHref={activationHref}
                  selected={selectedPlanCode === plan.code}
                  onSelect={() => setSelectedPlanCode(plan.code)}
                />
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-border/70 bg-background px-5 py-4 text-sm leading-6 text-muted-foreground">
              {copy.pricingFootnote}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.operationsTitle}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{copy.operationsBody}</p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {operationSignals.map((point) => {
              const Icon = point.icon
              return (
                <Card key={point.title} className="border-border/70 bg-card shadow-[0_20px_70px_-54px_rgba(15,23,42,0.45)]">
                  <CardContent className="p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-primary/5 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-xl font-semibold tracking-tight">{point.title}</div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{point.body}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <section id="rollout" className="border-y border-border/60 bg-muted/20 py-16 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.rolloutTitle}</h2>
              <p className="mt-4 text-lg text-muted-foreground">{copy.rolloutBody}</p>
            </div>
            <div className="grid gap-3">
              {copy.rolloutSteps.map((step, index) => (
                <div key={step.title} className="rounded-2xl border border-border/70 bg-background px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
                      {index + 1}
                    </div>
                    <div className="text-base font-semibold">{step.title}</div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-muted-foreground">{step.body}</div>
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
                  <Link to={ctaHref}>{user ? copy.finalPrimary : copy.primaryCta}</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href={talkHref}>{copy.finalSecondary}</a>
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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {copy.nav.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </a>
            ))}
            <span>{formatMzn(publicPricingPlans[0]?.monthlyMzn, locale)}+</span>
            <a href={talkHref} className="transition-colors hover:text-foreground">
              {copy.labels.talkToUs}
            </a>
            <Link to={signInHref} className="transition-colors hover:text-foreground">
              {signInLabel}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
