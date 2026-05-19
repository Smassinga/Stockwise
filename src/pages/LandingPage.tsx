import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, MotionConfig } from 'framer-motion'
import {
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  HandCoins,
  Landmark,
  LifeBuoy,
  Menu,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
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
import { formatMzn, publicPricingPlans } from '../lib/pricingPlans'
import { buildPublicMailto } from '../lib/publicContact'
import { cn } from '../lib/utils'

type ProductIconName = 'inventory' | 'sales' | 'purchases' | 'settlements' | 'compliance'
type ValueVisual = 'availability' | 'documents' | 'settlements' | 'purchases' | 'compliance'

type Copy = {
  nav: Array<{ label: string; href: string }>
  productLabel: string
  productMenu: Array<{ title: string; body: string; href: string; icon: ProductIconName }>
  heroEyebrow: string
  heroTitle: string
  heroBody: string
  heroSupport: string
  activationNote: string
  primaryCta: string
  secondaryCta: string
  proof: Array<{ value: string; label: string }>
  trustPoints: string[]
  capabilitiesEyebrow: string
  capabilitiesTitle: string
  capabilitiesBody: string
  valueCards: Array<{ id: string; title: string; body: string; visual: ValueVisual }>
  workflowEyebrow: string
  workflowTitle: string
  workflowBody: string
  workflowSteps: Array<{ title: string; body: string; points: string[]; icon: ProductIconName }>
  pricingEyebrow: string
  pricingTitle: string
  pricingBody: string
  pricingFootnote: string
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
    sampleView: string
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
      { label: 'Pricing', href: '#pricing' },
      { label: 'How it works', href: '#workflow' },
      { label: 'Support', href: '#support' },
    ],
    productLabel: 'Product',
    productMenu: [
      {
        title: 'Inventory',
        body: 'See stock risk before it becomes a sales problem.',
        href: '#inventory',
        icon: 'inventory',
      },
      {
        title: 'Sales and invoices',
        body: 'Keep orders, invoices, and payment follow-up connected.',
        href: '#sales',
        icon: 'sales',
      },
      {
        title: 'Purchases and vendor bills',
        body: 'Tie supplier obligations to incoming stock and landed cost.',
        href: '#purchases',
        icon: 'purchases',
      },
      {
        title: 'Payments and settlements',
        body: 'Know what is unpaid, partially paid, or settled.',
        href: '#settlements',
        icon: 'settlements',
      },
      {
        title: 'Compliance',
        body: 'Prepare Mozambique-focused finance records for review.',
        href: '#compliance',
        icon: 'compliance',
      },
    ],
    heroEyebrow: 'Mozambique-focused operations, records, and cash visibility',
    heroTitle: 'Run stock, sales, purchases, and payments from one decision-ready system.',
    heroBody:
      'StockWise helps growing businesses in Mozambique connect inventory, invoices, vendor bills, settlements, and fiscal-ready records, so owners can see what is moving, what is owed, and what needs action.',
    heroSupport: 'MZN-first pricing and records. Built by WiseCore Technologies, Lda.',
    activationNote:
      'Every new company starts with a 7-day trial. Paid access is still activated manually by the StockWise team.',
    primaryCta: 'Start with StockWise',
    secondaryCta: 'View how it works',
    proof: [
      { value: 'MZN-first', label: 'pricing and records' },
      { value: 'PT/EN', label: 'document output' },
      { value: '7-day', label: 'trial before activation' },
    ],
    trustPoints: [
      'Built for Mozambique-based stock, sales, purchasing, and settlement workflows.',
      'MZN-first pricing and operational records.',
      'Finance-document flow designed around invoices, vendor bills, settlements, and compliance exports.',
      'WiseCore Technologies, Lda.',
    ],
    capabilitiesEyebrow: 'Decision-ready product areas',
    capabilitiesTitle: 'Turn daily movement into the next action.',
    capabilitiesBody:
      'Each StockWise area is framed around the decision it helps make: what can be sold, what should be bought, what is still open, and which records need attention.',
    valueCards: [
      {
        id: 'inventory',
        title: 'Know what is available before selling',
        body: 'Check stock position, low-stock risk, and sellable quantity before confirming demand.',
        visual: 'availability',
      },
      {
        id: 'sales',
        title: 'Issue and track finance documents',
        body: 'Keep sales invoices and document status connected to operational orders.',
        visual: 'documents',
      },
      {
        id: 'settlements',
        title: 'See unpaid, partially paid, and settled balances',
        body: 'Identify what was sold, what was paid, and what still needs follow-up.',
        visual: 'settlements',
      },
      {
        id: 'purchases',
        title: 'Control purchases, vendor bills, and landed cost',
        body: 'Tie supplier obligations to incoming stock and cost visibility before margin drifts.',
        visual: 'purchases',
      },
      {
        id: 'compliance',
        title: 'Prepare Mozambique-focused fiscal records',
        body: 'Keep finance-document records and exports organised for review before submission.',
        visual: 'compliance',
      },
    ],
    workflowEyebrow: 'How it helps',
    workflowTitle: 'One flow from stock movement to cash visibility.',
    workflowBody:
      'StockWise connects the operating signals that are usually split across spreadsheets: inventory movement, sales invoices, vendor bills, settlements, and compliance review.',
    workflowSteps: [
      {
        title: 'Decide what can be sold',
        body: 'Use stock levels, low-stock signals, and warehouse context before committing to the next sale.',
        points: ['Available stock', 'Low-stock alerts', 'Warehouse movement'],
        icon: 'inventory',
      },
      {
        title: 'Know what is owed',
        body: 'Invoices, vendor bills, and settlements keep open balances visible instead of hidden in follow-up notes.',
        points: ['Due invoices', 'Vendor bills', 'Partial settlements'],
        icon: 'settlements',
      },
      {
        title: 'Prepare records with context',
        body: 'MZN values, finance-document history, and Mozambique compliance exports stay connected to the work that created them.',
        points: ['MZN records', 'Document trail', 'Compliance export'],
        icon: 'compliance',
      },
    ],
    pricingEyebrow: 'Commercial plans',
    pricingTitle: 'Pricing',
    pricingBody:
      'Choose the operational depth and support level that fits the business. Pricing stays public in MZN while paid access is still activated manually by StockWise.',
    pricingFootnote:
      'Automatic checkout is not active. Trial access, activation, and rollout are handled directly by the StockWise team.',
    finalTitle: 'Ready to see stock, cash, and open balances in one place?',
    finalBody:
      'Start the trial, review the workflow, or talk to StockWise about a managed rollout for a live workspace.',
    finalPrimary: 'Open StockWise',
    finalSecondary: 'Talk to us',
    signIn: 'Sign in',
    footerTagline: 'Inventory, invoices, vendor bills, settlements, and compliance visibility for Mozambique.',
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
      sampleView: 'Sample operating view',
    },
    managedPricingNoteTitle: 'Managed engagement',
    managedPricingNoteBody:
      'Pricing stays anchored to the annual engagement. Onboarding depth, refresher sessions, and rollout handling are scoped directly with the StockWise team.',
  },
  pt: {
    nav: [
      { label: 'Preços', href: '#pricing' },
      { label: 'Como funciona', href: '#workflow' },
      { label: 'Suporte', href: '#support' },
    ],
    productLabel: 'Produto',
    productMenu: [
      {
        title: 'Inventário',
        body: 'Veja risco de stock antes de virar problema de venda.',
        href: '#inventory',
        icon: 'inventory',
      },
      {
        title: 'Vendas e faturas',
        body: 'Mantenha encomendas, faturas e cobrança ligados.',
        href: '#sales',
        icon: 'sales',
      },
      {
        title: 'Compras e vendor bills',
        body: 'Ligue obrigações de fornecedor ao stock recebido e ao landed cost.',
        href: '#purchases',
        icon: 'purchases',
      },
      {
        title: 'Pagamentos e liquidações',
        body: 'Saiba o que está por pagar, parcial ou liquidado.',
        href: '#settlements',
        icon: 'settlements',
      },
      {
        title: 'Conformidade',
        body: 'Prepare registos financeiros focados em Moçambique para revisão.',
        href: '#compliance',
        icon: 'compliance',
      },
    ],
    heroEyebrow: 'Operações, registos e caixa focados em Moçambique',
    heroTitle: 'Controle stock, vendas, compras e pagamentos num sistema pronto para decisão.',
    heroBody:
      'O StockWise ajuda empresas em crescimento em Moçambique a ligar inventário, faturas, vendor bills, liquidações e registos preparados para fiscalidade, para que os donos vejam o que está a mexer, o que está em dívida e o que exige ação.',
    heroSupport: 'Preços e registos primeiro em MZN. Criado pela WiseCore Technologies, Lda.',
    activationNote:
      'Cada nova empresa começa com um teste de 7 dias. O acesso pago continua a ser ativado manualmente pela equipa StockWise.',
    primaryCta: 'Começar com StockWise',
    secondaryCta: 'Ver como funciona',
    proof: [
      { value: 'MZN', label: 'preços e registos' },
      { value: 'PT/EN', label: 'saída documental' },
      { value: '7 dias', label: 'teste antes da ativação' },
    ],
    trustPoints: [
      'Criado para fluxos de stock, vendas, compras e liquidações em empresas de Moçambique.',
      'Preços e registos operacionais primeiro em MZN.',
      'Fluxo documental financeiro desenhado para faturas, vendor bills, liquidações e exportações de conformidade.',
      'WiseCore Technologies, Lda.',
    ],
    capabilitiesEyebrow: 'Áreas prontas para decisão',
    capabilitiesTitle: 'Transforme movimento diário na próxima ação.',
    capabilitiesBody:
      'Cada área do StockWise responde a uma decisão: o que pode vender, o que deve comprar, o que continua em aberto e que registos precisam de atenção.',
    valueCards: [
      {
        id: 'inventory',
        title: 'Saiba o que está disponível antes de vender',
        body: 'Veja posição de stock, risco de ruptura e quantidade vendável antes de confirmar procura.',
        visual: 'availability',
      },
      {
        id: 'sales',
        title: 'Emita e acompanhe documentos financeiros',
        body: 'Mantenha faturas e estado documental ligados às encomendas operacionais.',
        visual: 'documents',
      },
      {
        id: 'settlements',
        title: 'Veja saldos por pagar, parciais e liquidados',
        body: 'Identifique o que foi vendido, o que foi pago e o que ainda exige seguimento.',
        visual: 'settlements',
      },
      {
        id: 'purchases',
        title: 'Controle compras, vendor bills e landed cost',
        body: 'Ligue obrigações de fornecedor ao stock recebido e ao custo antes da margem se perder.',
        visual: 'purchases',
      },
      {
        id: 'compliance',
        title: 'Prepare registos fiscais focados em Moçambique',
        body: 'Mantenha registos documentais e exportações organizados para revisão antes da submissão.',
        visual: 'compliance',
      },
    ],
    workflowEyebrow: 'Como ajuda',
    workflowTitle: 'Um fluxo do movimento de stock à visibilidade de caixa.',
    workflowBody:
      'O StockWise liga sinais operacionais que normalmente ficam espalhados por folhas: movimento de inventário, faturas, vendor bills, liquidações e revisão de conformidade.',
    workflowSteps: [
      {
        title: 'Decida o que pode vender',
        body: 'Use níveis de stock, alertas de baixo stock e contexto de armazém antes de confirmar a próxima venda.',
        points: ['Stock disponível', 'Alertas de ruptura', 'Movimento por armazém'],
        icon: 'inventory',
      },
      {
        title: 'Saiba o que está em dívida',
        body: 'Faturas, vendor bills e liquidações mantêm saldos abertos visíveis em vez de ficarem em notas soltas.',
        points: ['Faturas vencidas', 'Vendor bills', 'Liquidações parciais'],
        icon: 'settlements',
      },
      {
        title: 'Prepare registos com contexto',
        body: 'Valores em MZN, histórico documental e exportações de conformidade continuam ligados ao trabalho que os criou.',
        points: ['Registos em MZN', 'Trilho documental', 'Exportação de conformidade'],
        icon: 'compliance',
      },
    ],
    pricingEyebrow: 'Planos comerciais',
    pricingTitle: 'Preços',
    pricingBody:
      'Escolha o nível de controlo operacional e suporte que faz sentido para o negócio. Os valores continuam públicos em MZN enquanto o acesso pago é ativado manualmente pela StockWise.',
    pricingFootnote:
      'O checkout automático ainda não está ativo. O teste, a ativação e o rollout são tratados diretamente pela equipa StockWise.',
    finalTitle: 'Pronto para ver stock, caixa e saldos em aberto no mesmo lugar?',
    finalBody:
      'Comece o teste, reveja o fluxo ou fale com a StockWise sobre uma implementação acompanhada para um workspace real.',
    finalPrimary: 'Abrir StockWise',
    finalSecondary: 'Falar connosco',
    signIn: 'Iniciar sessão',
    footerTagline: 'Visibilidade de inventário, faturas, vendor bills, liquidações e conformidade para Moçambique.',
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
      sampleView: 'Visão operacional de exemplo',
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
      headline: 'Balanced visibility for growing operating teams.',
      bestFor:
        'A company that needs stronger visibility, more users, and better follow-up across stock, sales, and balances.',
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
      bestFor:
        'A business that wants the Business plan plus more direct rollout support, refresher training, and periodic operational guidance.',
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
      headline: 'Visibilidade equilibrada para equipas em crescimento.',
      bestFor:
        'Uma empresa que precisa de mais visibilidade, mais utilizadores e melhor seguimento de stock, vendas e saldos.',
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
      bestFor:
        'Um negócio que quer o plano Business com mais apoio de rollout, formação de reforço e orientação operacional periódica.',
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

const productIconMap = {
  inventory: Warehouse,
  sales: ReceiptText,
  purchases: Boxes,
  settlements: Wallet,
  compliance: FileCheck2,
} satisfies Record<ProductIconName, typeof Warehouse>

const defaultPricingPlanCode = publicPricingPlans.find((plan) => plan.highlight)?.code ?? publicPricingPlans[0]?.code ?? ''
const revealEase = [0.22, 1, 0.36, 1] as const

function ProductIcon({ name, className }: { name: ProductIconName; className?: string }) {
  const Icon = productIconMap[name]
  return <Icon className={className} />
}

type Tone = 'blue' | 'amber' | 'emerald' | 'rose' | 'slate'

const toneClasses: Record<Tone, string> = {
  blue: 'border-sky-300/40 bg-sky-400/10 text-sky-700 dark:text-sky-100',
  amber: 'border-amber-300/50 bg-amber-400/10 text-amber-800 dark:text-amber-100',
  emerald: 'border-emerald-300/50 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100',
  rose: 'border-rose-300/50 bg-rose-400/10 text-rose-700 dark:text-rose-100',
  slate: 'border-border/70 bg-muted/25 text-muted-foreground',
}

function StatusChip({ children, tone = 'blue' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClasses[tone])}>
      {children}
    </span>
  )
}

function PreviewPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_60px_-44px_rgba(0,0,0,0.85)]', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="h-2 w-2 rounded-full bg-sky-300" />
      </div>
      {children}
    </div>
  )
}

function DashboardPreview({ lang, sampleLabel }: { lang: 'en' | 'pt'; sampleLabel: string }) {
  const labels =
    lang === 'pt'
      ? {
          board: 'Painel de decisão',
          workspace: 'Operação comercial',
          stockValue: 'Valor de stock',
          dueInvoices: 'Faturas em aberto',
          vendorBills: 'Vendor bills',
          stockRisk: 'Risco de stock antes da venda',
          financeFlow: 'Fluxo documental',
          settlement: 'Liquidação',
          compliance: 'Conformidade MZ',
          exportReady: 'Exportação pronta para revisão',
          landedCost: 'Landed cost por rever',
          action: 'Ação sugerida',
          buy: 'Repor antes da próxima venda',
        }
      : {
          board: 'Decision board',
          workspace: 'Trading operation',
          stockValue: 'Stock value',
          dueInvoices: 'Due invoices',
          vendorBills: 'Vendor bills',
          stockRisk: 'Stock risk before selling',
          financeFlow: 'Document flow',
          settlement: 'Settlement',
          compliance: 'MZ compliance',
          exportReady: 'Export ready for review',
          landedCost: 'Landed cost to review',
          action: 'Suggested action',
          buy: 'Reorder before the next sale',
        }

  const stockRows = [
    { item: lang === 'pt' ? 'Arroz 25kg' : 'Rice 25kg', qty: '42', tone: 'emerald' as const },
    { item: lang === 'pt' ? 'Óleo 5L' : 'Cooking oil 5L', qty: '8', tone: 'amber' as const },
    { item: lang === 'pt' ? 'Açúcar 1kg' : 'Sugar 1kg', qty: '3', tone: 'rose' as const },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[660px]">
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-700/70 bg-slate-950 p-3 text-white shadow-[0_36px_120px_-62px_rgba(15,23,42,0.82)] sm:p-4">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/18 via-transparent to-sky-300/10" />
        <div className="relative rounded-[1.4rem] border border-white/10 bg-slate-950/82 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs font-semibold uppercase text-sky-200">{sampleLabel}</div>
              <div className="mt-1 text-lg font-semibold text-white">{labels.board}</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs text-slate-200">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-200" />
              {labels.workspace}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: labels.stockValue, value: '1 248 900 MZN', icon: Warehouse },
              { label: labels.dueInvoices, value: '246 500 MZN', icon: ReceiptText },
              { label: labels.vendorBills, value: lang === 'pt' ? '3 por rever' : '3 to review', icon: FileText },
            ].map((metric) => {
              const Icon = metric.icon
              return (
                <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                  <div className="flex items-center justify-between gap-2 text-slate-300">
                    <span className="text-[11px] font-semibold uppercase">{metric.label}</span>
                    <Icon className="h-4 w-4 text-sky-200" />
                  </div>
                  <div className="mt-2 text-base font-semibold text-white">{metric.value}</div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.08fr_0.92fr]">
            <PreviewPanel title={labels.stockRisk}>
              <div className="space-y-3">
                {stockRows.map((row) => (
                  <div key={row.item} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-slate-900/70 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">{row.item}</div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            row.tone === 'emerald' ? 'w-4/5 bg-emerald-300' : '',
                            row.tone === 'amber' ? 'w-2/5 bg-amber-300' : '',
                            row.tone === 'rose' ? 'w-1/5 bg-rose-300' : '',
                          )}
                        />
                      </div>
                    </div>
                    <StatusChip tone={row.tone}>{row.qty}</StatusChip>
                  </div>
                ))}
              </div>
            </PreviewPanel>

            <PreviewPanel title={labels.financeFlow}>
              <div className="space-y-3">
                {[
                  { label: 'SO-248', chip: lang === 'pt' ? 'Vendido' : 'Sold', tone: 'slate' as const },
                  { label: 'INV-248', chip: lang === 'pt' ? 'Emitida' : 'Issued', tone: 'blue' as const },
                  { label: labels.settlement, chip: lang === 'pt' ? 'Parcial' : 'Partial', tone: 'amber' as const },
                ].map((item, index) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/8 text-xs font-semibold text-sky-100">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{item.label}</span>
                        <StatusChip tone={item.tone}>{item.chip}</StatusChip>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </PreviewPanel>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-amber-100">{labels.landedCost}</div>
                <PackageCheck className="h-4 w-4 text-amber-100" />
              </div>
              <div className="mt-3 text-xs text-amber-50/75">{labels.action}</div>
              <div className="mt-1 text-sm font-medium text-white">{labels.buy}</div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-emerald-100">{labels.compliance}</div>
                <ClipboardCheck className="h-4 w-4 text-emerald-100" />
              </div>
              <div className="mt-3 text-xs text-emerald-50/75">SAF-T / MZ</div>
              <div className="mt-1 text-sm font-medium text-white">{labels.exportReady}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BentoVisual({ visual, lang }: { visual: ValueVisual; lang: 'en' | 'pt' }) {
  if (visual === 'availability') {
    const rows = [
      { item: lang === 'pt' ? 'Produto A' : 'Item A', qty: '128', tone: 'emerald' as const },
      { item: lang === 'pt' ? 'Produto B' : 'Item B', qty: '18', tone: 'amber' as const },
      { item: lang === 'pt' ? 'Produto C' : 'Item C', qty: '4', tone: 'rose' as const },
    ]

    return (
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.item} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
            <div className="min-w-0 text-sm font-medium">{row.item}</div>
            <StatusChip tone={row.tone}>{row.qty}</StatusChip>
          </div>
        ))}
      </div>
    )
  }

  if (visual === 'documents') {
    return (
      <div className="grid gap-2">
        {[
          ['SO-101', lang === 'pt' ? 'Confirmada' : 'Confirmed'],
          ['INV-101', lang === 'pt' ? 'Emitida' : 'Issued'],
          ['CRN-004', lang === 'pt' ? 'Revista' : 'Reviewed'],
        ].map(([label, status]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
            <span className="font-mono text-sm">{label}</span>
            <StatusChip>{status}</StatusChip>
          </div>
        ))}
      </div>
    )
  }

  if (visual === 'settlements') {
    const bars = [
      { label: lang === 'pt' ? 'Em aberto' : 'Unpaid', width: 'w-4/5', tone: 'bg-rose-400' },
      { label: lang === 'pt' ? 'Parcial' : 'Partial', width: 'w-3/5', tone: 'bg-amber-400' },
      { label: lang === 'pt' ? 'Liquidado' : 'Settled', width: 'w-5/6', tone: 'bg-emerald-400' },
    ]

    return (
      <div className="space-y-3">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{bar.label}</span>
              <span>MZN</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full', bar.width, bar.tone)} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (visual === 'purchases') {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">VB-223</div>
            <div className="mt-1 text-sm font-semibold">{lang === 'pt' ? 'Fornecedor por lançar' : 'Supplier bill pending'}</div>
          </div>
          <StatusChip tone="amber">{lang === 'pt' ? 'Custo' : 'Cost'}</StatusChip>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-muted/45 p-3">
            <div className="text-xs text-muted-foreground">CIF</div>
            <div className="font-semibold">MZN 41 900</div>
          </div>
          <div className="rounded-xl bg-muted/45 p-3">
            <div className="text-xs text-muted-foreground">Landed</div>
            <div className="font-semibold">+8.4%</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {[
        [lang === 'pt' ? 'Faturas' : 'Invoices', lang === 'pt' ? 'Revisto' : 'Reviewed', 'emerald' as const],
        ['Vendor bills', lang === 'pt' ? 'Pendente' : 'Pending', 'amber' as const],
        ['SAF-T / MZ', lang === 'pt' ? 'Preparar' : 'Prepare', 'blue' as const],
      ].map(([label, status, tone]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
          <span className="text-sm font-medium">{label}</span>
          <StatusChip tone={tone as Tone}>{status}</StatusChip>
        </div>
      ))}
    </div>
  )
}

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
  const billingRows = [
    { label: copy.labels.monthly, value: formatMzn(plan.monthlyMzn, locale) },
    { label: copy.labels.sixMonth, value: formatMzn(plan.sixMonthMzn, locale) },
    { label: copy.labels.onboarding, value: formatMzn(plan.onboardingMzn, locale) },
  ]

  return (
    <Card
      data-pricing-plan={plan.code}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      tabIndex={0}
      aria-label={plan.name}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      className={cn(
        'group relative flex h-full cursor-pointer flex-col overflow-hidden border-border/70 bg-card shadow-[0_26px_90px_-62px_rgba(15,23,42,0.55)] transition-[transform,border-color,box-shadow,background-color] duration-200 ease-out hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_34px_110px_-64px_rgba(15,23,42,0.65)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
        selected ? 'border-primary/50 bg-gradient-to-b from-primary/[0.055] via-card to-card' : '',
        plan.highlight ? 'ring-1 ring-amber-300/50 dark:ring-amber-300/25' : '',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent transition-opacity duration-200',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      />

      <div className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.04] p-5">
        <div className="flex min-h-8 flex-wrap items-start gap-2">
          {plan.highlight ? (
            <StatusChip tone="amber">{copy.labels.recommended}</StatusChip>
          ) : null}
          {selected ? <StatusChip>{copy.labels.selected}</StatusChip> : null}
        </div>

        <div className="mt-4">
          <div className="text-2xl font-semibold">{plan.name}</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.headline}</p>
        </div>

        <div className="mt-5 rounded-2xl border border-border/70 bg-background p-4">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">
            {managed ? copy.labels.from : copy.labels.annual}
          </div>
          <div className="mt-2 break-words text-3xl font-semibold leading-tight">
            {formatMzn(plan.startingAnnualMzn ?? plan.annualMzn, locale)}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{copy.labels.annual}</div>
          {plan.annualSavingMzn ? (
            <div className="mt-3">
              <StatusChip tone="emerald">
                {copy.labels.annualSaving}: {formatMzn(plan.annualSavingMzn, locale)}
              </StatusChip>
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-background px-3 py-3">
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.labels.company}</div>
            <div className="mt-1 text-sm font-medium">{plan.companyAccountLabel || '-'}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background px-3 py-3">
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.labels.users}</div>
            <div className="mt-1 text-sm font-medium">{plan.userLimitLabel || '-'}</div>
          </div>
        </div>

        {!managed ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {billingRows.map((row) => (
              <div key={row.label} className="rounded-2xl border border-border/70 bg-background px-3 py-3">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">{row.label}</div>
                <div className="mt-1 break-words text-sm font-semibold">{row.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-border/70 bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">
              {copy.managedPricingNoteTitle}
            </div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">{copy.managedPricingNoteBody}</div>
          </div>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col gap-5 p-5">
        <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.labels.bestFor}</div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">{content.bestFor}</div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.labels.includes}</div>
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
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.labels.support}</div>
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
          <Button className="justify-between" asChild>
            {managed ? (
              <a href={demoHref}>
                {copy.labels.talkToUs}
                <ArrowRight className="h-4 w-4" />
              </a>
            ) : (
              <Link to={trialHref}>
                {copy.labels.trial}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </Button>
          <Button variant="outline" className="justify-between" asChild>
            <a href={activationHref}>
              {managed ? copy.labels.bookDemo : copy.labels.requestActivation}
              <ArrowRight className="h-4 w-4" />
            </a>
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/92 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link to="/" className="min-w-0">
              <BrandLockup compact />
            </Link>

            <nav className="hidden items-center gap-2 lg:flex" aria-label="Primary navigation">
              <div className="group/nav relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                >
                  {copy.productLabel}
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-hover/nav:rotate-180 group-focus-within/nav:rotate-180" />
                </button>
                <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-3 w-[760px] -translate-x-1/2 opacity-0 transition-[opacity,transform] duration-200 group-hover/nav:pointer-events-auto group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100">
                  <div className="grid grid-cols-[1fr_1fr] gap-2 rounded-[1.4rem] border border-border/70 bg-background/96 p-3 shadow-[0_32px_90px_-54px_rgba(15,23,42,0.55)] backdrop-blur">
                    {copy.productMenu.map((item) => (
                      <a
                        key={item.title}
                        href={item.href}
                        className="group/item flex gap-3 rounded-2xl border border-transparent p-3 transition-colors hover:border-primary/15 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-primary">
                          <ProductIcon name={item.icon} className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                          <span className="mt-1 block text-sm leading-5 text-muted-foreground">{item.body}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {copy.nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
              <ThemeToggle compact />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {menuOpen ? (
            <div className="border-t border-border/60 bg-background px-4 py-4 lg:hidden">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-2">
                  <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    {copy.productLabel}
                  </div>
                  <div className="grid gap-1">
                    {copy.productMenu.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="flex items-start gap-3 rounded-xl px-3 py-2 text-sm hover:bg-background"
                        onClick={() => setMenuOpen(false)}
                      >
                        <ProductIcon name={item.icon} className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>
                          <span className="block font-medium">{item.title}</span>
                          <span className="mt-0.5 block text-muted-foreground">{item.body}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
                {copy.nav.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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

        <main className="overflow-hidden">
          <section id="product" className="relative border-b border-border/60 bg-gradient-to-b from-background via-muted/30 to-background">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:px-8 lg:pb-20 lg:pt-20">
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: revealEase }}
                className="max-w-3xl"
              >
                <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {copy.heroEyebrow}
                </div>
                <h1 className="mt-6 text-balance text-[2.55rem] font-semibold leading-[1.05] sm:text-5xl lg:text-[4.35rem]">
                  {copy.heroTitle}
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{copy.heroBody}</p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" asChild>
                    <Link to={ctaHref}>
                      {primaryCtaLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <a href="#workflow">{copy.secondaryCta}</a>
                  </Button>
                </div>

                <div className="mt-5 flex max-w-2xl items-start gap-3 rounded-2xl border border-border/70 bg-background/85 px-4 py-3 text-sm leading-6 text-muted-foreground shadow-sm">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{copy.activationNote}</span>
                </div>

                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  {copy.proof.map((item) => (
                    <div key={item.value} className="rounded-2xl border border-border/70 bg-background/85 p-4 shadow-sm">
                      <div className="text-xl font-semibold text-foreground">{item.value}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{item.label}</div>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.65, delay: 0.08, ease: revealEase }}
              >
                <DashboardPreview lang={lang} sampleLabel={copy.labels.sampleView} />
              </motion.div>
            </div>
          </section>

          <section className="border-b border-border/60 bg-background">
            <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
              {copy.trustPoints.map((point, index) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/18 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                    {index === 0 ? <Warehouse className="h-4 w-4" /> : null}
                    {index === 1 ? <Banknote className="h-4 w-4" /> : null}
                    {index === 2 ? <FileCheck2 className="h-4 w-4" /> : null}
                    {index === 3 ? <Landmark className="h-4 w-4" /> : null}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{point}</p>
                </div>
              ))}
            </div>
          </section>

          <section
            id="capabilities"
            className="relative bg-gradient-to-b from-background via-muted/20 to-background py-16 lg:py-24"
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="max-w-3xl">
                <div className="inline-flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Sparkles className="mr-2 h-4 w-4 text-primary" />
                  {copy.capabilitiesEyebrow}
                </div>
                <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">{copy.capabilitiesTitle}</h2>
                <p className="mt-4 text-lg leading-8 text-muted-foreground">{copy.capabilitiesBody}</p>
              </div>

              <div className="mt-10 grid gap-4 lg:grid-cols-12">
                {copy.valueCards.map((card) => (
                  <Card
                    key={card.id}
                    id={card.id}
                    className={cn(
                      'group overflow-hidden border-border/70 bg-card/95 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_30px_90px_-62px_rgba(15,23,42,0.55)]',
                      card.visual === 'availability' ? 'lg:col-span-7' : '',
                      card.visual === 'documents' ? 'lg:col-span-5' : '',
                      ['settlements', 'purchases', 'compliance'].includes(card.visual) ? 'lg:col-span-4' : '',
                    )}
                  >
                    <CardContent className="grid h-full gap-6 p-5 sm:p-6">
                      <div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-primary/5 text-primary">
                          <ProductIcon
                            name={
                              card.visual === 'availability'
                                ? 'inventory'
                                : card.visual === 'documents'
                                  ? 'sales'
                                  : card.visual === 'purchases'
                                    ? 'purchases'
                                    : card.visual === 'settlements'
                                      ? 'settlements'
                                      : 'compliance'
                            }
                            className="h-5 w-5"
                          />
                        </div>
                        <h3 className="mt-4 text-xl font-semibold leading-tight">{card.title}</h3>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.body}</p>
                      </div>
                      <BentoVisual visual={card.visual} lang={lang} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section
            id="workflow"
            className="border-y border-border/60 bg-slate-950 py-16 text-white lg:py-24"
          >
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
              <div>
                <div className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold uppercase text-sky-100">
                  <TrendingUp className="mr-2 h-4 w-4" />
                  {copy.workflowEyebrow}
                </div>
                <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">{copy.workflowTitle}</h2>
                <p className="mt-4 text-lg leading-8 text-slate-300">{copy.workflowBody}</p>
                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                  <div className="text-sm font-semibold text-sky-100">{copy.heroSupport}</div>
                </div>
              </div>

              <div className="grid gap-4">
                {copy.workflowSteps.map((step, index) => (
                  <div key={step.title} className="group rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-5 transition-[background-color,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-sky-300/25 hover:bg-white/[0.08]">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-100">
                        <ProductIcon name={step.icon} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase text-slate-400">
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        <h3 className="mt-1 text-xl font-semibold text-white">{step.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{step.body}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {step.points.map((point) => (
                            <span key={point} className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-medium text-slate-200">
                              {point}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            id="pricing"
            className="bg-gradient-to-b from-background via-muted/30 to-background py-16 lg:py-24"
          >
            <div className="mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    <BadgeDollarSign className="mr-2 h-4 w-4 text-primary" />
                    {copy.pricingEyebrow}
                  </div>
                  <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">{copy.pricingTitle}</h2>
                  <p className="mt-4 text-lg leading-8 text-muted-foreground">{copy.pricingBody}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background px-5 py-4 text-sm leading-6 text-muted-foreground lg:max-w-sm">
                  {copy.pricingFootnote}
                </div>
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
            </div>
          </section>

          <section id="support" className="border-t border-border/60 bg-background py-16 lg:py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.08] via-card to-card shadow-[0_30px_100px_-66px_rgba(15,23,42,0.58)]">
                <CardContent className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center lg:p-10">
                  <div className="max-w-2xl">
                    <div className="inline-flex items-center rounded-full border border-primary/20 bg-background/80 px-3 py-1.5 text-xs font-semibold uppercase text-primary">
                      <LifeBuoy className="mr-2 h-4 w-4" />
                      {lang === 'pt' ? 'Próximo passo' : 'Next step'}
                    </div>
                    <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">{copy.finalTitle}</h2>
                    <p className="mt-4 text-lg leading-8 text-muted-foreground">{copy.finalBody}</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                    <Button size="lg" asChild>
                      <Link to={ctaHref}>
                        {user ? copy.finalPrimary : copy.primaryCta}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="lg" variant="outline" asChild>
                      <a href={talkHref}>
                        {copy.finalSecondary}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </main>

        <footer className="border-t border-border/60 bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
            <div className="max-w-sm">
              <BrandLockup subtitle={copy.footerTagline} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <a href="#product" className="transition-colors hover:text-foreground">
                {copy.productLabel}
              </a>
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
    </MotionConfig>
  )
}
