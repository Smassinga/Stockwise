import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, MotionConfig } from 'framer-motion'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react/dist/lib/types'
import { BankIcon } from '@phosphor-icons/react/dist/csr/Bank'
import { BarcodeIcon } from '@phosphor-icons/react/dist/csr/Barcode'
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings'
import { CashRegisterIcon } from '@phosphor-icons/react/dist/csr/CashRegister'
import { ChartBarIcon } from '@phosphor-icons/react/dist/csr/ChartBar'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CoinsIcon } from '@phosphor-icons/react/dist/csr/Coins'
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/csr/DeviceMobile'
import { FactoryIcon } from '@phosphor-icons/react/dist/csr/Factory'
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp'
import { HandCoinsIcon } from '@phosphor-icons/react/dist/csr/HandCoins'
import { InvoiceIcon } from '@phosphor-icons/react/dist/csr/Invoice'
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key'
import { LifebuoyIcon } from '@phosphor-icons/react/dist/csr/Lifebuoy'
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple'
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey'
import { PlantIcon } from '@phosphor-icons/react/dist/csr/Plant'
import { PresentationChartIcon } from '@phosphor-icons/react/dist/csr/PresentationChart'
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question'
import { SealCheckIcon } from '@phosphor-icons/react/dist/csr/SealCheck'
import { ShieldCheckIcon as PhosphorShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { TruckIcon } from '@phosphor-icons/react/dist/csr/Truck'
import { WarningDiamondIcon } from '@phosphor-icons/react/dist/csr/WarningDiamond'
import {
  ArrowRight,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react'
import BrandLockup from '../components/brand/BrandLockup'
import LocaleToggle from '../components/LocaleToggle'
import ThemeToggle from '../components/ThemeToggle'
import { IconBadge } from '../components/premium/IconBadge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../lib/i18n'
import { buildPublicMailto, PUBLIC_CONTACT_EMAIL } from '../lib/publicContact'
import { formatMzn, publicPricingPlans, type PublicPricingPlan } from '../lib/pricingPlans'
import { cn } from '../lib/utils'

type Lang = 'en' | 'pt'
type PricingPeriod = 'monthly' | 'six_month' | 'annual'

const PRICING_PERIOD_STORAGE_KEY = 'stockwise:landing:pricing-period'

const pricingPeriodOptions: PricingPeriod[] = ['monthly', 'six_month', 'annual']

type IconName =
  | 'stock'
  | 'checkout'
  | 'documents'
  | 'access'
  | 'reports'
  | 'records'
  | 'receiving'
  | 'settlements'
  | 'imports'
  | 'cash'
  | 'mobile'
  | 'support'
  | 'security'
  | 'growth'
  | 'production'
  | 'attention'
  | 'connected'
  | 'stockReady'
  | 'company'
  | 'activation'
  | 'question'

type LandingCopy = {
  nav: Array<{ label: string; href: string }>
  productLabel: string
  productMenu: Array<{ title: string; body: string; href: string; icon: IconName }>
  heroTitle: string
  heroBody: string
  primaryCta: string
  secondaryCta: string
  activationNote: string
  operationTitle: string
  operationBody: string
  operationFits: Array<{ title: string; body: string; icon: IconName }>
  trustSignals: Array<{ title: string; body: string; icon: IconName }>
  problemTitle: string
  problemBody: string
  problems: Array<{ title: string; body: string }>
  capabilitiesTitle: string
  capabilitiesBody: string
  capabilities: Array<{ title: string; body: string; icon: IconName }>
  showcaseTitle: string
  showcaseBody: string
  showcaseNote: string
  workflowTitle: string
  workflowBody: string
  workflowSteps: Array<{ title: string; body: string; icon: IconName }>
  useCasesTitle: string
  useCasesBody: string
  useCases: Array<{ title: string; body: string; icon: IconName }>
  complianceTitle: string
  complianceBody: string
  compliancePoints: string[]
  complianceCaution: string
  pricingTitle: string
  pricingBody: string
  pricingFootnote: string
  faqTitle: string
  faqBody: string
  faqs: Array<{ question: string; answer: string }>
  teamTitle: string
  teamBody: string
  teamMembers: Array<{ name: string; role: string; body: string }>
  finalTitle: string
  finalBody: string
  finalSecondary: string
  signIn: string
  openDashboard: string
  footerTagline: string
  labels: {
    annual: string
    monthly: string
    sixMonth: string
    pricingPeriod: string
    perMonth: string
    billedMonthly: string
    everySixMonths: string
    perYear: string
    equivalentMonthly: (amount: string) => string
    saveEverySixMonths: (amount: string) => string
    saveAnnually: (amount: string) => string
    contactUs: string
    billingByProposal: string
    onboarding: string
    bestFor: string
    includes: string
    support: string
    users: string
    company: string
    from: string
    recommended: string
    requestActivation: string
    talkToUs: string
    viewPricing: string
    productPreview: string
    sampleOnly: string
    sectionProduct: string
    supportEmail: string
    wiseCore: string
    builtBy: string
    office: string
  }
  pricingContent: Record<string, PlanContent>
  mailSubjects: {
    demo: string
    activation: string
    contact: string
  }
}

type PlanContent = {
  headline: string
  bestFor: string
  included: string[]
  support: string[]
}

const iconMap = {
  stock: StackIcon,
  checkout: CashRegisterIcon,
  documents: InvoiceIcon,
  access: KeyIcon,
  reports: PresentationChartIcon,
  records: SealCheckIcon,
  receiving: TruckIcon,
  settlements: HandCoinsIcon,
  imports: FileArrowUpIcon,
  cash: BankIcon,
  mobile: DeviceMobileIcon,
  support: LifebuoyIcon,
  security: PhosphorShieldCheckIcon,
  growth: PlantIcon,
  production: FactoryIcon,
  attention: WarningDiamondIcon,
  connected: LinkSimpleIcon,
  stockReady: BarcodeIcon,
  company: BuildingsIcon,
  activation: LockKeyIcon,
  question: QuestionIcon,
} satisfies Record<IconName, PhosphorIcon>

const revealEase = [0.22, 1, 0.36, 1] as const

const portuguesePlanCompanyLabels: Record<string, string> = {
  starter: '1 conta de empresa',
  growth: '1 conta de empresa',
  business: '1 conta de empresa',
  managed_business_plus: 'Acesso ao plano Business',
}

const portuguesePlanUserLabels: Record<string, string> = {
  starter: 'Até 2 utilizadores',
  growth: 'Até 5 utilizadores',
  business: 'Até 10 utilizadores',
  managed_business_plus: 'Âmbito de utilizadores por proposta',
}

const copyByLang: Record<Lang, LandingCopy> = {
  en: {
    nav: [
      { label: 'How it works', href: '#workflow' },
      { label: 'Use cases', href: '#use-cases' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Team', href: '#team' },
      { label: 'FAQ', href: '#faq' },
    ],
    productLabel: 'Product',
    productMenu: [
      {
        title: 'Stock control',
        body: 'Items, stock levels, movements, and low-stock signals.',
        href: '#capabilities',
        icon: 'stock',
      },
      {
        title: 'POS and sales',
        body: 'Daily selling, sales orders, and stock-linked activity.',
        href: '#capabilities',
        icon: 'checkout',
      },
      {
        title: 'Finance documents',
        body: 'Invoices, notes, vendor bills, and settlement follow-up.',
        href: '#records',
        icon: 'documents',
      },
      {
        title: 'Growth batches',
        body: 'Active batches, measurements, direct costs, stock inputs, and reversals.',
        href: '#operations',
        icon: 'growth',
      },
    ],
    heroTitle: 'StockWise',
    heroBody:
      'Control stock, purchases, sales, payments, production activity, and growth batches in one serious workspace built for real Mozambican operations.',
    primaryCta: 'Start 7-day trial',
    secondaryCta: 'View pricing',
    activationNote:
      'Every new company starts with a 7-day trial. Paid activation is handled manually by the StockWise team.',
    operationTitle: 'Built around how the business actually works.',
    operationBody:
      'StockWise is organised around operating flows first, then modules. That makes the product easier to understand for owners, managers, and teams moving away from spreadsheets.',
    operationFits: [
      {
        title: 'For buying and reselling',
        body: 'Receive stock, sell through POS or orders, and keep availability, documents, and settlement follow-up connected.',
        icon: 'stockReady',
      },
      {
        title: 'For production and transformation',
        body: 'Track materials, production runs, finished goods, cost context, and the records that support daily control.',
        icon: 'production',
      },
      {
        title: 'For growth batches',
        body: 'Follow active batches with measurements, direct costs, stock-input material cost, and event-specific reversals.',
        icon: 'growth',
      },
      {
        title: 'For counter sales and cash control',
        body: 'Keep selling, stock movement, users, cash, bank, and owner visibility in the same operating picture.',
        icon: 'checkout',
      },
    ],
    trustSignals: [
      {
        title: 'Stock control',
        body: 'Know what is available before selling or purchasing.',
        icon: 'stock',
      },
      {
        title: 'POS-ready',
        body: 'Keep counter sales connected to items and stock movement.',
        icon: 'checkout',
      },
      {
        title: 'Finance documents',
        body: 'Organise invoices, notes, vendor bills, and settlements.',
        icon: 'documents',
      },
      {
        title: 'User roles',
        body: 'Give owners, managers, and operators controlled access.',
        icon: 'access',
      },
      {
        title: 'Growth Batches',
        body: 'Track active batches, measurements, direct costs, stock inputs, and reversal evidence.',
        icon: 'growth',
      },
      {
        title: 'Mozambique-ready records',
        body: 'Prepare structured NUIT, IVA, MZN, and fiscal document data.',
        icon: 'records',
      },
    ],
    problemTitle: 'The everyday challenges costing your business control',
    problemBody:
      'Most growing businesses do not lose control in one big event. It happens through small daily gaps: stock sold without movement records, purchases that never update availability, invoices saved in different places, and payments tracked outside the system.',
    problems: [
      {
        title: 'Stock tracked in Excel or manual books',
        body: 'Quantity on hand becomes a debate when receipts, sales, and adjustments are not tied to one ledger.',
      },
      {
        title: 'Sales are not linked to stock movement',
        body: 'Revenue looks useful, but owners cannot always see whether stock and cost records support it.',
      },
      {
        title: 'Invoices and receipts saved in different places',
        body: 'Documents, folders, paper copies, and message threads do not tell one story.',
      },
      {
        title: 'Hard to see what is owed, paid, or still pending',
        body: 'Paid, partially paid, and pending records sit outside the daily operating picture.',
      },
      {
        title: 'Managers do not know what needs attention',
        body: 'Open balances, pending documents, and low-stock items stay hidden until they become urgent.',
      },
    ],
    capabilitiesTitle: 'A serious workspace for daily business control.',
    capabilitiesBody:
      'StockWise connects stock, selling, purchasing, finance documents, settlement follow-up, and reports without forcing the team into separate tools.',
    capabilities: [
      {
        title: 'Items and stock levels',
        body: 'Create items, set minimum stock, review on-hand quantities, and see stock risk before it becomes a sales problem.',
        icon: 'stock',
      },
      {
        title: 'POS and sales',
        body: 'Use POS and sales workflows with stock-linked operating records and practical order follow-up.',
        icon: 'checkout',
      },
      {
        title: 'Purchases and vendor bills',
        body: 'Track purchase orders, receiving, supplier obligations, and cost visibility in one operational flow.',
        icon: 'receiving',
      },
      {
        title: 'Growth batches and inputs',
        body: 'Manage active batches, measurements, direct costs, stock-input material cost, and controlled reversals.',
        icon: 'growth',
      },
      {
        title: 'Invoices and notes',
        body: 'Organise invoices, credit notes, debit notes, NUIT, IVA/VAT, currency, and document status.',
        icon: 'documents',
      },
      {
        title: 'Settlements, cash, and bank',
        body: 'Review paid, partially paid, and open balances with cash and bank context.',
        icon: 'settlements',
      },
      {
        title: 'Reports and dashboards',
        body: 'See operational revenue, COGS, gross margin, inventory value, and activity from the dashboard.',
        icon: 'reports',
      },
      {
        title: 'Users and roles',
        body: 'Invite users and give controlled access to operational and administrative workspaces.',
        icon: 'access',
      },
      {
        title: 'Import and export',
        body: 'Bring in opening stock and work with exportable records for review, preparation, and reporting.',
        icon: 'imports',
      },
    ],
    showcaseTitle: 'From scattered records to organised operating control.',
    showcaseBody:
      'StockWise connects the operational pieces so owners can see what exists, what moved, what was sold, what is owed, and what needs attention.',
    showcaseNote: 'Illustrative preview based on current StockWise workflows. Values shown are sample operating data.',
    workflowTitle: 'From company setup to a clearer operating flow.',
    workflowBody:
      'StockWise follows the way daily work moves: setup, stock, operations, documents, settlement follow-up, and review.',
    workflowSteps: [
      {
        title: 'Create the company workspace',
        body: 'Set up the company profile, users, roles, warehouses, and operating preferences.',
        icon: 'security',
      },
      {
        title: 'Add or import items and opening stock',
        body: 'Start with item records, stock levels, minimum-stock thresholds, and initial inventory data.',
        icon: 'imports',
      },
      {
        title: 'Record sales, purchases, POS, and movements',
        body: 'Keep daily operating events, stock movement, and commercial records in one traceable flow.',
        icon: 'connected',
      },
      {
        title: 'Control production and active batches',
        body: 'Use production and Growth Batch records where the operation needs materials, measurements, or input cost evidence.',
        icon: 'production',
      },
      {
        title: 'Issue documents and track settlements',
        body: 'Organise invoices, notes, vendor bills, cash, bank, payment follow-up, dashboards, and reports.',
        icon: 'documents',
      },
    ],
    useCasesTitle: 'Built for businesses where records need to line up.',
    useCasesBody:
      'Keep stock, sales, purchases, documents, payments, and operating costs connected in one organised workspace.',
    useCases: [
      {
        title: 'Bakery or small producer',
        body: 'Connect materials, production runs, counter sales, purchasing, and stock visibility without losing the cost trail.',
        icon: 'production',
      },
      {
        title: 'Butchery or food retail',
        body: 'Keep receiving, stock movement, sales, and low-stock signals visible for items where freshness and rotation matter.',
        icon: 'stockReady',
      },
      {
        title: 'Agro, nursery, or biological growth',
        body: 'Use active Growth Batches for measurements, direct costs, stock inputs, and reversal evidence.',
        icon: 'growth',
      },
      {
        title: 'Warehouse or distributor',
        body: 'Control purchasing, receiving, movements, role-based work, and stock risk across operating locations.',
        icon: 'stock',
      },
    ],
    complianceTitle: 'Prepare cleaner fiscal and business records.',
    complianceBody:
      'StockWise supports structured records for review and preparation, with Mozambique-relevant business details kept close to the transaction history.',
    compliancePoints: [
      'Organise invoices, credit notes, debit notes, NUIT, IVA/VAT, currency, settlements, and exportable fiscal document data.',
      'Keep document status, customer and supplier records, MZN values, and operational context in the same workspace.',
      'Use exportable data and reports to support internal review and accountant preparation.',
    ],
    complianceCaution:
      'Official submissions should be validated by your accountant or fiscal advisor.',
    pricingTitle: 'Published pricing with a controlled trial path.',
    pricingBody:
      'Choose the plan that fits the operating depth and support level your business needs. Paid activation remains handled by StockWise.',
    pricingFootnote:
      'The 7-day trial can start from the app. Self-serve checkout is not active; activation, onboarding, and rollout support are handled directly.',
    faqTitle: 'Questions before starting',
    faqBody: 'Straight answers about trial access, records, mobile use, and rollout.',
    faqs: [
      {
        question: 'Is the trial automatic?',
        answer:
          'A new company can start with a 7-day trial. Paid access is activated manually by the StockWise team after the trial or commercial review.',
      },
      {
        question: 'What happens after the trial?',
        answer:
          'StockWise can review the right plan with you and activate paid access once the commercial arrangement is confirmed.',
      },
      {
        question: 'Can I import items and opening stock?',
        answer:
          'Yes. StockWise includes opening-data import workflows so a company can move from spreadsheets into a structured item and stock baseline.',
      },
      {
        question: 'Can I track active Growth Batches?',
        answer:
          'Yes. StockWise supports active batch records, measurements, direct costs, stock inputs, and event-specific reversals.',
      },
      {
        question: 'Does it work on mobile?',
        answer:
          'Yes. Core public and authenticated surfaces are responsive, and operational screens are being polished around mobile workflows.',
      },
      {
        question: 'Does StockWise replace my accountant?',
        answer:
          'No. StockWise helps prepare cleaner records, but official submissions and fiscal decisions should be validated by your accountant or fiscal advisor.',
      },
      {
        question: 'Does it support Mozambique records?',
        answer:
          'StockWise supports Mozambique-relevant records such as NUIT, IVA/VAT context, MZN values, invoices, notes, settlements, and exportable fiscal document data.',
      },
      {
        question: 'Can I invite users?',
        answer:
          'Yes. Company workspaces support user invitations and roles so each person has access appropriate to their work.',
      },
      {
        question: 'Does StockWise include a Point of Sale workspace?',
        answer:
          'Yes. StockWise includes a Point of Sale workspace designed for fast counter sales. Each completed sale remains connected to the related stock movement and business records.',
      },
    ],
    teamTitle: 'Built by WiseCore Technologies, Lda.',
    teamBody:
      'WiseCore Technologies, Lda. gives StockWise a visible legal and operating identity. The product is built from Beira for businesses that need accountable rollout, support, and practical control.',
    teamMembers: [
      {
        name: 'Samuel Massinga',
        role: 'Founder and CEO',
        body: 'Product direction, operating workflow design, rollout discipline, and StockWise delivery.',
      },
      {
        name: 'Alda Jofrice',
        role: 'Co-Founder and Executive Manager',
        body: 'Customer operations, implementation follow-up, business controls, and executive coordination.',
      },
      {
        name: 'Galileu Gonçalves',
        role: 'Co-founder and Chief Operating Officer',
        body: 'Sales and customer acquisition.',
      },
    ],
    finalTitle: 'Ready to bring stock, operations, and records into one workspace?',
    finalBody:
      'Start the 7-day trial or contact StockWise for a controlled activation and rollout conversation.',
    finalSecondary: 'Talk to us',
    signIn: 'Sign in',
    openDashboard: 'Open dashboard',
    footerTagline:
      'Inventory, sales, purchases, documents, settlements, reports, users, and Mozambique-ready records in one serious workspace.',
    labels: {
      annual: 'Annual',
      monthly: 'Monthly',
      sixMonth: '6 months',
      pricingPeriod: 'Pricing period',
      perMonth: 'per month',
      billedMonthly: 'Billed monthly',
      everySixMonths: 'every 6 months',
      perYear: 'per year',
      equivalentMonthly: (amount: string) => `Equivalent to ${amount} per month`,
      saveEverySixMonths: (amount: string) => `Save ${amount} every 6 months`,
      saveAnnually: (amount: string) => `Save ${amount} annually`,
      contactUs: 'Contact us',
      billingByProposal: 'Billing by proposal',
      onboarding: 'Onboarding',
      bestFor: 'Best for',
      includes: 'What is included',
      support: 'Implementation and support',
      users: 'Users',
      company: 'Company account',
      from: 'From',
      recommended: 'Recommended',
      requestActivation: 'Request activation',
      talkToUs: 'Talk to us',
      viewPricing: 'View pricing',
      productPreview: 'Product preview',
      sampleOnly: 'Sample operating data',
      sectionProduct: 'Product areas',
      supportEmail: 'Contact email',
      wiseCore: 'WiseCore Technologies, Lda.',
      builtBy: 'Built by',
      office: 'Beira, Mozambique',
    },
    pricingContent: {
      starter: {
        headline: 'A clean entry point for businesses leaving spreadsheets behind.',
        bestFor: 'Smaller businesses that need stock, orders, customers, and suppliers under control.',
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
          'Growing companies that need stronger reporting, follow-up, and implementation guidance.',
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
        bestFor:
          'Established teams with more users, more follow-up needs, and more complex day-to-day execution.',
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
          'Businesses that want the Business plan plus more direct rollout support, refresher training, and periodic guidance.',
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
    mailSubjects: {
      demo: 'StockWise demo request',
      activation: 'StockWise activation request',
      contact: 'StockWise commercial contact',
    },
  },
  pt: {
    nav: [
      { label: 'Como funciona', href: '#workflow' },
      { label: 'Casos de uso', href: '#use-cases' },
      { label: 'Preços', href: '#pricing' },
      { label: 'Equipa', href: '#team' },
      { label: 'FAQ', href: '#faq' },
    ],
    productLabel: 'Produto',
    productMenu: [
      {
        title: 'Controlo de stock',
        body: 'Itens, níveis de stock, movimentos e alertas de baixo stock.',
        href: '#capabilities',
        icon: 'stock',
      },
      {
        title: 'POS e vendas',
        body: 'Vendas diárias, encomendas e atividade ligada ao stock.',
        href: '#capabilities',
        icon: 'checkout',
      },
      {
        title: 'Documentos financeiros',
        body: 'Faturas, notas, vendor bills e seguimento de liquidações.',
        href: '#records',
        icon: 'documents',
      },
      {
        title: 'Growth Batches',
        body: 'Lotes ativos, medições, custos diretos, inputs de stock e reversões.',
        href: '#operations',
        icon: 'growth',
      },
    ],
    heroTitle: 'StockWise',
    heroBody:
      'Controle stock, compras, vendas, pagamentos, produção e lotes em crescimento num workspace sério, criado para operações reais em Moçambique.',
    primaryCta: 'Iniciar teste de 7 dias',
    secondaryCta: 'Ver preços',
    activationNote:
      'Cada nova empresa começa com um teste de 7 dias. A ativação paga é tratada manualmente pela equipa StockWise.',
    operationTitle: 'Construído à volta da forma como o negócio trabalha.',
    operationBody:
      'O StockWise organiza primeiro os fluxos operacionais e só depois os módulos. Isso torna o produto mais claro para donos, gestores e equipas que estão a sair das folhas soltas.',
    operationFits: [
      {
        title: 'Para quem compra e revende',
        body: 'Receba stock, venda por POS ou encomendas e mantenha disponibilidade, documentos e liquidações ligados.',
        icon: 'stockReady',
      },
      {
        title: 'Para produção e transformação',
        body: 'Acompanhe materiais, produções, produto acabado, contexto de custo e registos de controlo diário.',
        icon: 'production',
      },
      {
        title: 'Para lotes em crescimento',
        body: 'Siga lotes ativos com medições, custos diretos, custo material de inputs e reversões por evento.',
        icon: 'growth',
      },
      {
        title: 'Para balcão e controlo de caixa',
        body: 'Mantenha vendas, movimento de stock, utilizadores, caixa, bancos e visibilidade do dono na mesma operação.',
        icon: 'checkout',
      },
    ],
    trustSignals: [
      {
        title: 'Controlo de stock',
        body: 'Saiba o que está disponível antes de vender ou comprar.',
        icon: 'stock',
      },
      {
        title: 'Pronto para POS',
        body: 'Ligue vendas de balcão a itens e movimentos de stock.',
        icon: 'checkout',
      },
      {
        title: 'Documentos financeiros',
        body: 'Organize faturas, notas, vendor bills e liquidações.',
        icon: 'documents',
      },
      {
        title: 'Funções de utilizador',
        body: 'Dê acesso controlado a donos, gestores e operadores.',
        icon: 'access',
      },
      {
        title: 'Growth Batches',
        body: 'Acompanhe lotes ativos, medições, custos diretos, inputs de stock e evidência de reversão.',
        icon: 'growth',
      },
      {
        title: 'Registos para Moçambique',
        body: 'Prepare dados estruturados de NUIT, IVA, MZN e documentos fiscais.',
        icon: 'records',
      },
    ],
    problemTitle: 'Os desafios diários que custam controlo ao negócio',
    problemBody:
      'A maioria dos negócios em crescimento não perde controlo num único grande evento. Acontece em pequenas falhas diárias: stock vendido sem registo de movimento, compras que não atualizam disponibilidade, faturas guardadas em lugares diferentes e pagamentos seguidos fora do sistema.',
    problems: [
      {
        title: 'Stock controlado em Excel ou livros manuais',
        body: 'A quantidade disponível vira debate quando receções, vendas e ajustes não estão ligados a um único registo.',
      },
      {
        title: 'Vendas não ligadas ao movimento de stock',
        body: 'A receita parece útil, mas o dono nem sempre vê se o stock e o custo sustentam a venda.',
      },
      {
        title: 'Faturas e recibos guardados em lugares diferentes',
        body: 'Documentos, pastas, cópias em papel e mensagens não contam uma história única.',
      },
      {
        title: 'Difícil ver o que está em dívida, pago ou pendente',
        body: 'Registos pagos, parciais e pendentes ficam fora da visão operacional diária.',
      },
      {
        title: 'Gestores não sabem o que precisa de atenção',
        body: 'Saldos em aberto, documentos pendentes e itens com baixo stock ficam escondidos até virarem urgência.',
      },
    ],
    capabilitiesTitle: 'Um workspace sério para o controlo diário do negócio.',
    capabilitiesBody:
      'O StockWise liga stock, vendas, compras, documentos financeiros, liquidações e relatórios sem obrigar a equipa a saltar entre ferramentas.',
    capabilities: [
      {
        title: 'Itens e níveis de stock',
        body: 'Crie itens, defina stock mínimo, reveja quantidades disponíveis e veja riscos antes de afetarem vendas.',
        icon: 'stock',
      },
      {
        title: 'POS e vendas',
        body: 'Use POS e fluxos de venda com registos operacionais ligados ao stock e ao seguimento de encomendas.',
        icon: 'checkout',
      },
      {
        title: 'Compras e vendor bills',
        body: 'Acompanhe ordens de compra, receções, obrigações de fornecedores e visibilidade de custo.',
        icon: 'receiving',
      },
      {
        title: 'Growth Batches e inputs',
        body: 'Gira lotes ativos, medições, custos diretos, custo material de inputs de stock e reversões controladas.',
        icon: 'growth',
      },
      {
        title: 'Faturas e notas',
        body: 'Organize faturas, notas de crédito, notas de débito, NUIT, IVA, moeda e estado documental.',
        icon: 'documents',
      },
      {
        title: 'Liquidações, caixa e bancos',
        body: 'Reveja saldos pagos, parciais e em aberto com contexto de caixa e banco.',
        icon: 'settlements',
      },
      {
        title: 'Relatórios e dashboards',
        body: 'Veja receita operacional, COGS, margem bruta, valor de stock e atividade no dashboard.',
        icon: 'reports',
      },
      {
        title: 'Utilizadores e funções',
        body: 'Convide utilizadores e dê acesso controlado a áreas operacionais e administrativas.',
        icon: 'access',
      },
      {
        title: 'Importação e exportação',
        body: 'Carregue stock inicial e trabalhe com registos exportáveis para revisão, preparação e reporting.',
        icon: 'imports',
      },
    ],
    showcaseTitle: 'De registos espalhados para controlo operacional organizado.',
    showcaseBody:
      'O StockWise liga as peças operacionais para que os donos vejam o que existe, o que mexeu, o que foi vendido, o que está por pagar e o que precisa de atenção.',
    showcaseNote: 'Pré-visualização ilustrativa baseada nos fluxos atuais do StockWise. Os valores são exemplos.',
    workflowTitle: 'Da configuração da empresa a um fluxo operacional mais claro.',
    workflowBody:
      'O StockWise segue a forma como o trabalho diário se move: configuração, stock, operações, documentos, liquidações e revisão.',
    workflowSteps: [
      {
        title: 'Crie o workspace da empresa',
        body: 'Configure perfil da empresa, utilizadores, funções, armazéns e preferências de operação.',
        icon: 'security',
      },
      {
        title: 'Adicione ou importe itens e stock inicial',
        body: 'Comece com itens, níveis de stock, limites mínimos e dados iniciais de inventário.',
        icon: 'imports',
      },
      {
        title: 'Registe vendas, compras, POS e movimentos',
        body: 'Mantenha eventos diários, movimento de stock e registos comerciais num fluxo rastreável.',
        icon: 'connected',
      },
      {
        title: 'Controle produção e lotes ativos',
        body: 'Use produção e Growth Batches quando a operação precisa de materiais, medições ou evidência de custo de inputs.',
        icon: 'production',
      },
      {
        title: 'Emita documentos e acompanhe liquidações',
        body: 'Organize faturas, notas, vendor bills, caixa, banco, pagamentos, dashboards e relatórios.',
        icon: 'documents',
      },
    ],
    useCasesTitle: 'Criado para negócios onde os registos precisam de alinhar.',
    useCasesBody:
      'Mantenha stock, vendas, compras, documentos, pagamentos e custos operacionais ligados num workspace organizado.',
    useCases: [
      {
        title: 'Pastelaria ou pequena produção',
        body: 'Ligue materiais, produções, vendas ao balcão, compras e visibilidade de stock sem perder o rasto de custo.',
        icon: 'production',
      },
      {
        title: 'Talho ou retalho alimentar',
        body: 'Mantenha receções, movimento de stock, vendas e sinais de reposição visíveis para itens onde frescura e rotação importam.',
        icon: 'stockReady',
      },
      {
        title: 'Agro, viveiro ou crescimento biológico',
        body: 'Use Growth Batches ativos para medições, custos diretos, histórico de inputs e evidência de reversão.',
        icon: 'growth',
      },
      {
        title: 'Armazém ou distribuidor',
        body: 'Controle compras, receções, movimentos, funções da equipa e risco de stock entre locais operacionais.',
        icon: 'stock',
      },
    ],
    complianceTitle: 'Prepare registos fiscais e comerciais mais limpos.',
    complianceBody:
      'O StockWise apoia registos estruturados para revisão e preparação, mantendo detalhes relevantes para Moçambique junto do histórico da transação.',
    compliancePoints: [
      'Organize faturas, notas de crédito, notas de débito, NUIT, IVA, moeda, liquidações e dados fiscais exportáveis.',
      'Mantenha estado documental, clientes, fornecedores, valores em MZN e contexto operacional no mesmo workspace.',
      'Use dados exportáveis e relatórios para apoiar revisão interna e preparação pelo contabilista.',
    ],
    complianceCaution:
      'Submissões oficiais devem ser validadas pelo seu contabilista ou consultor fiscal.',
    pricingTitle: 'Preços publicados com um caminho de teste controlado.',
    pricingBody:
      'Escolha o plano que combina com a profundidade operacional e o suporte de que o negócio precisa. A ativação paga continua a ser tratada pela StockWise.',
    pricingFootnote:
      'O teste de 7 dias pode começar na aplicação. O checkout self-service não está ativo; ativação, onboarding e rollout são tratados diretamente.',
    faqTitle: 'Perguntas antes de começar',
    faqBody: 'Respostas diretas sobre teste, registos, mobile e implementação.',
    faqs: [
      {
        question: 'O teste é automático?',
        answer:
          'Uma nova empresa pode começar com um teste de 7 dias. O acesso pago é ativado manualmente pela equipa StockWise depois da revisão comercial.',
      },
      {
        question: 'O que acontece depois do teste?',
        answer:
          'A StockWise pode rever consigo o plano adequado e ativar o acesso pago quando o acordo comercial estiver confirmado.',
      },
      {
        question: 'Posso importar itens e stock inicial?',
        answer:
          'Sim. O StockWise inclui fluxos de importação inicial para passar de folhas para uma base estruturada de itens e stock.',
      },
      {
        question: 'Posso acompanhar Growth Batches ativos?',
        answer:
          'Sim. O StockWise suporta lotes ativos, medições, custos diretos, inputs de stock e reversões por evento.',
      },
      {
        question: 'Funciona no telemóvel?',
        answer:
          'Sim. As áreas públicas e autenticadas são responsivas, e os ecrãs operacionais estão a ser polidos para fluxos mobile.',
      },
      {
        question: 'Substitui o meu contabilista?',
        answer:
          'Não. O StockWise ajuda a preparar registos mais limpos, mas submissões oficiais e decisões fiscais devem ser validadas pelo contabilista ou consultor fiscal.',
      },
      {
        question: 'Suporta registos de Moçambique?',
        answer:
          'O StockWise suporta registos relevantes como NUIT, IVA, valores em MZN, faturas, notas, liquidações e dados fiscais exportáveis.',
      },
      {
        question: 'Posso convidar utilizadores?',
        answer:
          'Sim. Os workspaces de empresa suportam convites e funções para ajustar o acesso ao trabalho de cada pessoa.',
      },
      {
        question: 'O StockWise inclui um espaço de Ponto de Venda?',
        answer:
          'Sim. O StockWise inclui um espaço de Ponto de Venda concebido para registar vendas ao balcão com rapidez. Cada venda concluída permanece ligada ao respectivo movimento de stock e aos registos comerciais.',
      },
    ],
    teamTitle: 'Criado pela WiseCore Technologies, Lda.',
    teamBody:
      'A WiseCore Technologies, Lda. dá ao StockWise uma identidade legal e operacional visível. O produto é construído a partir da Beira para negócios que precisam de rollout responsável, suporte e controlo prático.',
    teamMembers: [
      {
        name: 'Samuel Massinga',
        role: 'Founder and CEO',
        body: 'Direção de produto, desenho de fluxos operacionais, disciplina de rollout e entrega do StockWise.',
      },
      {
        name: 'Alda Jofrice',
        role: 'Co-Founder and Executive Manager',
        body: 'Operações com clientes, seguimento de implementação, controlos de negócio e coordenação executiva.',
      },
      {
        name: 'Galileu Gonçalves',
        role: 'Co-founder and Chief Operating Officer',
        body: 'Vendas e aquisição de clientes.',
      },
    ],
    finalTitle: 'Pronto para juntar stock, operações e registos no mesmo workspace?',
    finalBody:
      'Inicie o teste de 7 dias ou contacte a StockWise para uma conversa controlada de ativação e rollout.',
    finalSecondary: 'Falar connosco',
    signIn: 'Iniciar sessão',
    openDashboard: 'Abrir dashboard',
    footerTagline:
      'Inventário, vendas, compras, documentos, liquidações, relatórios, utilizadores e registos para Moçambique num workspace sério.',
    labels: {
      annual: 'Anual',
      monthly: 'Mensal',
      sixMonth: '6 meses',
      pricingPeriod: 'Período de preço',
      perMonth: 'por mês',
      billedMonthly: 'Cobrado mensalmente',
      everySixMonths: 'a cada 6 meses',
      perYear: 'por ano',
      equivalentMonthly: (amount: string) => `Equivalente a ${amount} por mês`,
      saveEverySixMonths: (amount: string) => `Poupe ${amount} em 6 meses`,
      saveAnnually: (amount: string) => `Poupe ${amount} por ano`,
      contactUs: 'Fale connosco',
      billingByProposal: 'Cobrança por proposta',
      onboarding: 'Onboarding',
      bestFor: 'Mais indicado para',
      includes: 'O que inclui',
      support: 'Implementação e suporte',
      users: 'Utilizadores',
      company: 'Conta da empresa',
      from: 'Desde',
      recommended: 'Recomendado',
      requestActivation: 'Pedir ativação',
      talkToUs: 'Falar connosco',
      viewPricing: 'Ver preços',
      productPreview: 'Pré-visualização do produto',
      sampleOnly: 'Dados operacionais de exemplo',
      sectionProduct: 'Áreas do produto',
      supportEmail: 'Email de contacto',
      wiseCore: 'WiseCore Technologies, Lda.',
      builtBy: 'Criado por',
      office: 'Beira, Moçambique',
    },
    pricingContent: {
      starter: {
        headline: 'Ponto de entrada limpo para empresas que saem das folhas soltas.',
        bestFor:
          'Negócios menores que precisam de stock, encomendas, clientes e fornecedores sob controlo.',
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
          'Empresas em crescimento que precisam de mais reporting, seguimento e apoio de implementação.',
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
        headline: 'Para operações diárias mais pesadas que exigem mais controlo.',
        bestFor:
          'Equipas estabelecidas com mais utilizadores, mais seguimento e operação diária mais complexa.',
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
        headline: 'Uma relação operacional mais acompanhada.',
        bestFor:
          'Empresas que querem o plano Business com mais apoio de rollout, formação de reforço e orientação periódica.',
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
    mailSubjects: {
      demo: 'Pedido de demonstração StockWise',
      activation: 'Pedido de ativação StockWise',
      contact: 'Contacto comercial StockWise',
    },
  },
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  const Component = iconMap[name]
  return <Component className={className} weight="duotone" aria-hidden="true" />
}

type LandingIconTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'critical' | 'info' | 'primary' | 'inverse'
type LandingIconSize = 'compact' | 'card' | 'feature' | 'empty'

function SectionIntro({
  title,
  body,
  align = 'left',
  inverse = false,
}: {
  title: string
  body: string
  align?: 'left' | 'center'
  inverse?: boolean
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : '')}>
      <h2
        className={cn(
          'text-3xl font-semibold leading-tight text-foreground sm:text-4xl',
          inverse ? 'text-white' : '',
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          'mt-4 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8',
          inverse ? 'text-slate-300' : '',
        )}
      >
        {body}
      </p>
    </div>
  )
}

function SurfaceIcon({
  name,
  dark = false,
  tone,
  size = 'feature',
  className,
}: {
  name: IconName
  dark?: boolean
  tone?: LandingIconTone
  size?: LandingIconSize
  className?: string
}) {
  return (
    <IconBadge tone={tone ?? (dark ? 'inverse' : 'primary')} size={size} className={className}>
      <Icon name={name} className="h-5 w-5" />
    </IconBadge>
  )
}

function InlineSurfaceIcon({
  name,
  dark = false,
  className,
}: {
  name: IconName
  dark?: boolean
  className?: string
}) {
  return (
    <Icon
      name={name}
      className={cn('h-5 w-5 shrink-0', dark ? 'text-sky-200' : 'text-primary', className)}
    />
  )
}

function StatusPill({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'slate' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold leading-none',
        tone === 'blue' ? 'border-sky-300/40 bg-sky-300/10 text-sky-700 dark:text-sky-100' : '',
        tone === 'green' ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-700 dark:text-emerald-100' : '',
        tone === 'amber' ? 'border-amber-300/50 bg-amber-300/10 text-amber-800 dark:text-amber-100' : '',
        tone === 'slate' ? 'border-slate-300/50 bg-slate-100 text-slate-700 dark:border-white/15 dark:bg-white/10 dark:text-slate-100' : '',
      )}
    >
      {children}
    </span>
  )
}

function ProductPreview({ copy, lang }: { copy: LandingCopy; lang: Lang }) {
  const labels =
    lang === 'pt'
      ? {
          dashboard: 'Dashboard operacional',
          today: 'Hoje',
          inventory: 'Valor de stock',
          revenue: 'Receita operacional',
          cogs: 'COGS',
          margin: 'Margem bruta',
          action: 'Ação necessária',
          lowStock: '3 itens abaixo do mínimo',
          documents: 'Documentos',
          issued: 'Emitida',
          partial: 'Parcial',
          received: 'Recebido',
          stock: 'Stock',
          payment: 'Liquidação',
          register: 'Registo operacional',
          warehouse: 'Armazém central',
        }
      : {
          dashboard: 'Operating dashboard',
          today: 'Today',
          inventory: 'Inventory value',
          revenue: 'Operational revenue',
          cogs: 'COGS',
          margin: 'Gross margin',
          action: 'Action needed',
          lowStock: '3 items below minimum',
          documents: 'Documents',
          issued: 'Issued',
          partial: 'Partial',
          received: 'Received',
          stock: 'Stock',
          payment: 'Settlement',
          register: 'Operating register',
          warehouse: 'Central warehouse',
        }

  const metrics = [
    { label: labels.inventory, value: 'MZN 128K', icon: StackIcon, tone: 'blue' as const },
    { label: labels.revenue, value: 'MZN 42K', icon: CashRegisterIcon, tone: 'green' as const },
    { label: labels.cogs, value: 'MZN 18K', icon: CoinsIcon, tone: 'amber' as const },
    { label: labels.margin, value: 'MZN 24K', icon: ChartBarIcon, tone: 'green' as const },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[680px]">
      <div className="rounded-xl border border-border bg-card p-3 text-foreground shadow-2xl shadow-slate-950/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:shadow-slate-950/30">
        <div className="rounded-lg border border-border bg-background/85 dark:border-white/10 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 dark:border-white/10">
            <div>
              <div className="text-xs font-semibold uppercase text-primary dark:text-sky-200">{copy.labels.productPreview}</div>
              <div className="mt-1 text-lg font-semibold">{labels.dashboard}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="slate">{labels.today}</StatusPill>
              <StatusPill tone="blue">{labels.warehouse}</StatusPill>
            </div>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {metrics.map((metric) => {
              const MetricIcon = metric.icon
              return (
                <div key={metric.label} className="rounded-lg border border-border bg-card p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3 text-muted-foreground dark:text-slate-300">
                    <span className="text-[0.72rem] font-semibold uppercase">{metric.label}</span>
                    <MetricIcon
                      className={cn(
                        'h-4 w-4',
                        metric.tone === 'green' ? 'text-emerald-600 dark:text-emerald-200' : '',
                        metric.tone === 'amber' ? 'text-amber-600 dark:text-amber-200' : '',
                        metric.tone === 'blue' ? 'text-primary dark:text-sky-200' : '',
                      )}
                      weight="duotone"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-2 text-xl font-semibold">{metric.value}</div>
                </div>
              )
            })}
          </div>

          <div className="grid gap-3 border-t border-border p-4 dark:border-white/10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-lg border border-border bg-background p-4 dark:border-white/10 dark:bg-slate-950/80">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{labels.action}</div>
                <StatusPill tone="amber">{labels.lowStock}</StatusPill>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  ['BK-001', lang === 'pt' ? 'Body kit' : 'Body kit', '10', 'green' as const],
                  ['OIL-005', lang === 'pt' ? 'Óleo 5L' : 'Oil 5L', '4', 'amber' as const],
                  ['RIM-020', lang === 'pt' ? 'Jante 20' : 'Rim 20', '1', 'amber' as const],
                ].map(([sku, item, qty, tone]) => (
                  <div key={sku} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 dark:bg-white/5">
                    <span className="font-mono text-xs text-muted-foreground dark:text-slate-400">{sku}</span>
                    <span className="min-w-0 truncate text-sm font-medium">{item}</span>
                    <StatusPill tone={tone}>{qty}</StatusPill>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background p-4 dark:border-white/10 dark:bg-slate-950/80">
              <div className="font-semibold">{labels.register}</div>
              <div className="mt-4 space-y-3">
                {[
                  ['INV-1042', labels.documents, labels.issued, 'blue' as const],
                  ['PO-318', labels.stock, labels.received, 'green' as const],
                  ['SET-211', labels.payment, labels.partial, 'amber' as const],
                ].map(([reference, label, status, tone]) => (
                  <div key={reference} className="rounded-lg border border-border bg-muted/50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm">{reference}</span>
                      <StatusPill tone={tone}>{status}</StatusPill>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground dark:text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground dark:border-white/10 dark:text-slate-400">
            {copy.showcaseNote}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProblemRecordsImage({ lang }: { lang: Lang }) {
  const altText =
    lang === 'pt'
      ? 'Mesa com folhas de inventário, faturas, recibos, calculadora e registos manuais do negócio.'
      : 'Desk with inventory sheets, invoices, receipts, calculator, and manual business records.'

  return (
    <figure className="landing-hover-lift overflow-hidden rounded-xl border border-border bg-card p-2 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-950/80 dark:shadow-black/35">
      <img
        src="/landing/stockwise-records-desk.png"
        alt={altText}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="h-72 w-full rounded-lg object-cover object-center sm:h-[420px] lg:h-[540px]"
      />
    </figure>
  )
}

function StructuredData({ lang }: { lang: Lang }) {
  const description =
    lang === 'pt'
      ? 'StockWise controla stock, vendas, compras, pagamentos, produção e lotes em crescimento para empresas em Moçambique.'
      : 'StockWise controls stock, sales, purchases, payments, production activity, and growth batches for Mozambican businesses.'

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://stockwiseapp.com/#organization',
        name: 'WiseCore Technologies, Lda.',
        legalName: 'WiseCore Technologies, Lda.',
        url: 'https://stockwiseapp.com/',
        logo: 'https://stockwiseapp.com/brand/wisecore-logo-light.png',
        email: PUBLIC_CONTACT_EMAIL,
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Beira',
          addressCountry: 'MZ',
        },
      },
      {
        '@type': 'WebApplication',
        '@id': 'https://stockwiseapp.com/#stockwise',
        name: 'StockWise',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: 'https://stockwiseapp.com/',
        image: 'https://stockwiseapp.com/landing/stockwise-records-desk.png',
        description,
        publisher: {
          '@id': 'https://stockwiseapp.com/#organization',
        },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'MZN',
          availability: 'https://schema.org/InStock',
          url: 'https://stockwiseapp.com/#pricing',
        },
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

function isPricingPeriod(value: string | null): value is PricingPeriod {
  return value === 'monthly' || value === 'six_month' || value === 'annual'
}

function getStoredPricingPeriod(): PricingPeriod {
  if (typeof window === 'undefined') return 'monthly'
  const stored = window.sessionStorage.getItem(PRICING_PERIOD_STORAGE_KEY)
  return isPricingPeriod(stored) ? stored : 'monthly'
}

function formatLandingMzn(value: number | null | undefined, locale: string) {
  const formatted = formatMzn(value, locale)
  if (formatted === '--') return formatted
  return `MZN ${formatted.replace(/\s*MZN$/, '')}`
}

function pricingPeriodLabel(copy: LandingCopy, period: PricingPeriod) {
  if (period === 'monthly') return copy.labels.monthly
  if (period === 'six_month') return copy.labels.sixMonth
  return copy.labels.annual
}

function pricingDisplayFor(plan: PublicPricingPlan, period: PricingPeriod, locale: string, copy: LandingCopy) {
  if (period === 'monthly') {
    if (plan.monthlyMzn == null) {
      return {
        from: false,
        price: copy.labels.contactUs,
        cadence: '',
        note: copy.labels.billingByProposal,
        savings: null,
      }
    }

    return {
      from: false,
      price: formatLandingMzn(plan.monthlyMzn, locale),
      cadence: copy.labels.perMonth,
      note: copy.labels.billedMonthly,
      savings: null,
    }
  }

  if (period === 'six_month') {
    const amount = plan.sixMonthMzn ?? (plan.monthlyMzn != null ? plan.monthlyMzn * 6 : null)
    if (amount == null) {
      return {
        from: false,
        price: copy.labels.contactUs,
        cadence: '',
        note: copy.labels.billingByProposal,
        savings: null,
      }
    }

    const saving =
      plan.sixMonthMzn != null && plan.monthlyMzn != null
        ? Math.max(0, plan.monthlyMzn * 6 - plan.sixMonthMzn)
        : 0

    return {
      from: false,
      price: formatLandingMzn(amount, locale),
      cadence: copy.labels.everySixMonths,
      note: copy.labels.equivalentMonthly(formatLandingMzn(amount / 6, locale)),
      savings: saving > 0 ? copy.labels.saveEverySixMonths(formatLandingMzn(saving, locale)) : null,
    }
  }

  const variableStartingPrice = plan.startingAnnualMzn != null && plan.startingAnnualMzn < plan.annualMzn
  const annualAmount =
    variableStartingPrice && plan.startingAnnualMzn != null ? plan.startingAnnualMzn : plan.annualMzn
  const saving =
    plan.annualSavingMzn ??
    (plan.monthlyMzn != null ? Math.max(0, plan.monthlyMzn * 12 - annualAmount) : 0)

  return {
    from: variableStartingPrice,
    price: formatLandingMzn(annualAmount, locale),
    cadence: copy.labels.perYear,
    note: copy.labels.equivalentMonthly(formatLandingMzn(annualAmount / 12, locale)),
    savings: saving > 0 ? copy.labels.saveAnnually(formatLandingMzn(saving, locale)) : null,
  }
}

function PricingCard({
  plan,
  content,
  copy,
  locale,
  period,
  trialHref,
  activationHref,
  ctaLabel,
}: {
  plan: PublicPricingPlan
  content: PlanContent
  copy: LandingCopy
  locale: string
  period: PricingPeriod
  trialHref: string
  activationHref: string
  ctaLabel: string
}) {
  const pricing = pricingDisplayFor(plan, period, locale, copy)
  const periodLabel = pricingPeriodLabel(copy, period)
  const isPortuguese = locale.startsWith('pt')
  const companyAccountLabel =
    isPortuguese
      ? (portuguesePlanCompanyLabels[plan.code] ?? plan.companyAccountLabel)
      : plan.companyAccountLabel
  const userLimitLabel =
    isPortuguese
      ? (portuguesePlanUserLabels[plan.code] ?? plan.userLimitLabel)
      : plan.userLimitLabel
  const onboardingPrice = plan.onboardingMzn != null ? formatLandingMzn(plan.onboardingMzn, locale) : null

  return (
    <Card
      className={cn(
        'landing-pricing-card group flex h-full flex-col border-border/70 bg-card shadow-sm',
        plan.highlight ? 'border-primary/45 shadow-md ring-1 ring-primary/25' : '',
      )}
    >
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {plan.highlight ? <StatusPill tone="blue">{copy.labels.recommended}</StatusPill> : null}
          {pricing.from ? <StatusPill tone="slate">{copy.labels.from}</StatusPill> : null}
        </div>

        <div className="mt-4">
          <h3 className="text-2xl font-semibold">{plan.name}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.headline}</p>
        </div>

        <div className="landing-pricing-price mt-5 min-h-40 rounded-lg border border-border bg-background p-4">
          <div className="flex min-h-6 flex-wrap items-center gap-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{periodLabel}</div>
            {pricing.savings ? <StatusPill tone="green">{pricing.savings}</StatusPill> : null}
          </div>
          <div className="mt-2 break-words text-3xl font-semibold">{pricing.price}</div>
          {pricing.cadence ? <div className="mt-1 text-sm font-medium text-foreground">{pricing.cadence}</div> : null}
          <div className="mt-2 text-sm leading-5 text-muted-foreground">{pricing.note}</div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.company}</div>
            <div className="mt-1 text-sm font-medium">{companyAccountLabel || '-'}</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.users}</div>
            <div className="mt-1 text-sm font-medium">{userLimitLabel || '-'}</div>
          </div>
        </div>

        {onboardingPrice ? (
          <div className="mt-3 grid gap-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.onboarding}</span>
              <span className="text-sm font-semibold">{onboardingPrice}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-5 rounded-lg border border-border/70 bg-muted/25 p-4">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.bestFor}</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.bestFor}</p>
        </div>

        <div className="mt-5 grid gap-5">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.includes}</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {content.included.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircleIcon className="mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" weight="duotone" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.labels.support}</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {content.support.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircleIcon className="mt-1 h-4 w-4 shrink-0 text-primary" weight="duotone" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-auto grid gap-3 pt-6">
          <Button
            asChild
            className="landing-pricing-primary-cta"
          >
            <Link to={trialHref}>
              {ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            variant="outline"
            asChild
            className="landing-pricing-secondary-cta"
          >
            <a href={activationHref}>
              {copy.labels.requestActivation}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
  const [pricingPeriod, setPricingPeriod] = useState<PricingPeriod>(getStoredPricingPeriod)

  const copy = copyByLang[lang]
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const trialHref = user ? '/dashboard' : '/login'
  const signInHref = user ? '/dashboard' : '/login'
  const primaryCtaLabel = user ? copy.openDashboard : copy.primaryCta
  const signInLabel = user ? copy.openDashboard : copy.signIn
  const activationHref = useMemo(() => buildPublicMailto(copy.mailSubjects.activation), [copy.mailSubjects.activation])
  const contactHref = useMemo(() => buildPublicMailto(copy.mailSubjects.contact), [copy.mailSubjects.contact])

  const selectPricingPeriod = (period: PricingPeriod) => {
    setPricingPeriod(period)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PRICING_PERIOD_STORAGE_KEY, period)
    }
  }

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const targets = Array.from(document.querySelectorAll<HTMLElement>('main > section, [data-landing-stagger] > *'))

    targets.forEach((target) => {
      const parent = target.parentElement
      const delay = parent?.hasAttribute('data-landing-stagger')
        ? Math.min(Array.from(parent.children).indexOf(target), 8) * 55
        : 0

      target.classList.add('landing-scroll-reveal')
      target.style.setProperty('--landing-delay', `${delay}ms`)

      if (prefersReducedMotion) {
        target.classList.add('is-visible')
      } else {
        target.classList.remove('is-visible')
      }
    })

    if (prefersReducedMotion) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px 10% 0px', threshold: 0.02 },
    )

    targets.forEach((target) => observer.observe(target))

    return () => observer.disconnect()
  }, [])

  const closeMenu = () => setMenuOpen(false)

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <StructuredData lang={lang} />
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link to="/" className="min-w-0" aria-label="StockWise home">
              <BrandLockup compact />
            </Link>

            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
              <div className="group/nav relative">
                <button
                  type="button"
                  aria-haspopup="true"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {copy.productLabel}
                  <ChevronDown className="h-4 w-4 transition-transform group-hover/nav:rotate-180 group-focus-within/nav:rotate-180" aria-hidden="true" />
                </button>
                <div className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-3 w-[620px] -translate-x-1/2 translate-y-1 opacity-0 transition-[opacity,transform] duration-200 group-hover/nav:visible group-hover/nav:pointer-events-auto group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-focus-within/nav:visible group-focus-within/nav:pointer-events-auto group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
                    {copy.productMenu.map((item) => (
                      <a
                        key={item.title}
                        href={item.href}
                        className="group/item flex gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-primary/25 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SurfaceIcon name={item.icon} size="compact" tone="neutral" />
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
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                <Link to={trialHref}>{primaryCtaLabel}</Link>
              </Button>
            </div>

            <div className="flex items-center gap-2 lg:hidden">
              <LocaleToggle />
              <ThemeToggle compact />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              </Button>
            </div>
          </div>

          {menuOpen ? (
            <div className="border-t border-border/70 bg-background px-4 py-4 lg:hidden">
              <div className="grid gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-2">
                  <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    {copy.labels.sectionProduct}
                  </div>
                  <div className="grid gap-1">
                    {copy.productMenu.map((item) => (
                      <a
                        key={item.title}
                        href={item.href}
                        onClick={closeMenu}
                        className="flex gap-3 rounded-lg px-3 py-2 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon name={item.icon} className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
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
                    onClick={closeMenu}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.label}
                  </a>
                ))}

                <div className="grid gap-2 pt-2">
                  <Button variant="outline" asChild>
                    <Link to={signInHref} onClick={closeMenu}>
                      {signInLabel}
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link to={trialHref} onClick={closeMenu}>
                      {primaryCtaLabel}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </header>

        <main className="overflow-hidden">
          <section className="relative isolate overflow-hidden border-b border-slate-900/25 bg-slate-950 text-white">
            <img
              src="/landing/stockwise-records-desk.png"
              alt=""
              aria-hidden="true"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 -z-20 h-full w-full object-cover object-center opacity-80"
            />
            <div className="absolute inset-0 -z-10 bg-slate-950/75" />

            <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16 xl:py-20">
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: revealEase }}
                className="max-w-3xl"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase text-sky-100 backdrop-blur">
                  <InlineSurfaceIcon name="company" dark className="h-3.5 w-3.5" />
                  <span>
                    {copy.labels.builtBy} {copy.labels.wiseCore}
                  </span>
                </div>

                <h1 className="mt-5 text-5xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">
                  {copy.heroTitle}
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-100 sm:text-xl sm:leading-9">{copy.heroBody}</p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" asChild>
                    <Link to={trialHref}>
                      {primaryCtaLabel}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <a href="#pricing">
                      {copy.secondaryCta}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                </div>

                <div className="mt-5 flex max-w-2xl gap-3 text-sm leading-6 text-slate-200">
                  <InlineSurfaceIcon name="activation" dark className="mt-0.5 h-4 w-4" />
                  <span>{copy.activationNote}</span>
                </div>

                <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3" data-landing-stagger>
                  {[
                    ['4', lang === 'pt' ? 'planos publicados' : 'published plans'],
                    ['7', lang === 'pt' ? 'dias de teste' : 'trial days'],
                    ['PT/EN', lang === 'pt' ? 'operação bilingue' : 'bilingual workspace'],
                  ].map(([value, label]) => (
                    <div key={value} className="rounded-lg border border-white/15 bg-white/10 p-3 backdrop-blur sm:p-4">
                      <div className="text-xl font-semibold text-white sm:text-2xl">{value}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-200 sm:text-sm">{label}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>

          <section id="operations" className="scroll-mt-24 border-b border-border/70 bg-background pb-14 pt-8 lg:py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <SectionIntro title={copy.operationTitle} body={copy.operationBody} align="center" />
              <div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-landing-stagger>
                {copy.operationFits.map((fit) => (
                  <div key={fit.title} className="landing-hover-lift rounded-lg border border-border bg-card p-5 shadow-sm">
                    <SurfaceIcon name={fit.icon} size="card" tone="info" />
                    <h2 className="mt-4 text-lg font-semibold leading-tight">{fit.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{fit.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="border-b border-border/70 bg-card">
            <div className="mx-auto grid max-w-7xl gap-3 px-4 py-8 sm:px-6 md:grid-cols-2 lg:grid-cols-3 lg:px-8" data-landing-stagger>
              {copy.trustSignals.map((signal) => (
                <div key={signal.title} className="landing-hover-lift flex gap-3 rounded-lg border border-border bg-background p-4">
                  <InlineSurfaceIcon name={signal.icon} className="mt-0.5 h-5 w-5" />
                  <div>
                    <h2 className="text-sm font-semibold">{signal.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{signal.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-background py-16 lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8">
              <div>
                <SectionIntro title={copy.problemTitle} body={copy.problemBody} />
                <div className="mt-8 grid gap-3" data-landing-stagger>
                  {copy.problems.map((problem, index) => (
                    <div key={problem.title} className="landing-hover-lift flex gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-sm font-semibold text-primary">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold leading-tight">{problem.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{problem.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <ProblemRecordsImage lang={lang} />
            </div>
          </section>

          <section id="capabilities" className="scroll-mt-24 border-y border-border/70 bg-muted/25 py-16 lg:py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <SectionIntro title={copy.capabilitiesTitle} body={copy.capabilitiesBody} align="center" />

              <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-landing-stagger>
                {copy.capabilities.map((capability) => (
                  <Card key={capability.title} className="group border-border/70 bg-card shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl">
                    <CardContent className="p-5 pt-5 sm:p-6 sm:pt-6">
                      <SurfaceIcon name={capability.icon} size="feature" tone="primary" />
                      <h3 className="mt-4 text-lg font-semibold leading-tight">{capability.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{capability.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section id="showcase" className="scroll-mt-24 bg-slate-950 py-16 text-white lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8">
              <div>
                <SectionIntro title={copy.showcaseTitle} body={copy.showcaseBody} inverse />
                <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1" data-landing-stagger>
                  {[
                    { title: lang === 'pt' ? 'Sinais de atenção' : 'Attention signals', icon: 'attention' as const },
                    { title: lang === 'pt' ? 'Registos ligados' : 'Connected records', icon: 'connected' as const },
                    { title: lang === 'pt' ? 'Stock antes da venda' : 'Stock before selling', icon: 'stockReady' as const },
                  ].map((item) => (
                    <div key={item.title} className="landing-hover-lift flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                      <InlineSurfaceIcon name={item.icon} dark className="h-5 w-5" />
                      <span className="text-sm font-semibold text-slate-100">{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.985 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.55, ease: revealEase }}
              >
                <ProductPreview copy={copy} lang={lang} />
              </motion.div>
            </div>
          </section>

          <section id="workflow" className="scroll-mt-24 bg-background py-16 lg:py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <SectionIntro title={copy.workflowTitle} body={copy.workflowBody} align="center" />

              <div className="mt-10 grid gap-4 lg:grid-cols-5" data-landing-stagger>
                {copy.workflowSteps.map((step, index) => (
                  <Card key={step.title} className="landing-hover-lift border-border/70 bg-card shadow-sm">
                    <CardContent className="p-5 pt-5 sm:p-6 sm:pt-6">
                      <div className="flex items-center justify-between gap-3">
                        <InlineSurfaceIcon name={step.icon} className="h-6 w-6" />
                        <span className="font-mono text-sm font-semibold text-muted-foreground">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <h3 className="mt-4 text-lg font-semibold leading-tight">{step.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section id="use-cases" className="scroll-mt-24 border-y border-border/70 bg-card py-16 lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
              <SectionIntro title={copy.useCasesTitle} body={copy.useCasesBody} />
              <div className="grid gap-4 sm:grid-cols-2" data-landing-stagger>
                {copy.useCases.map((useCase) => (
                  <div key={useCase.title} className="landing-hover-lift rounded-lg border border-border bg-background p-5 shadow-sm sm:p-6">
                    <div className="border-l-2 border-primary/35 pl-4">
                      <h3 className="text-lg font-semibold">{useCase.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{useCase.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="records" className="scroll-mt-24 bg-background py-16 lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-8">
              <SectionIntro title={copy.complianceTitle} body={copy.complianceBody} />
              <Card className="border-primary/20 bg-card shadow-sm">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex gap-3">
                    <SurfaceIcon name="records" size="card" tone="info" />
                    <div>
                      <h3 className="text-lg font-semibold">
                        {lang === 'pt' ? 'Registos preparados para revisão' : 'Records prepared for review'}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.complianceCaution}</p>
                    </div>
                  </div>
                  <ul className="mt-6 grid gap-3" data-landing-stagger>
                    {copy.compliancePoints.map((point) => (
                      <li key={point} className="flex gap-3 rounded-lg border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
                        <CheckCircleIcon className="mt-1 h-4 w-4 shrink-0 text-primary" weight="duotone" aria-hidden="true" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>

          <section id="pricing" className="scroll-mt-24 border-y border-border/70 bg-muted/25 py-16 lg:py-24">
            <div className="mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <SectionIntro title={copy.pricingTitle} body={copy.pricingBody} />
                <div className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground shadow-sm lg:max-w-sm">
                  {copy.pricingFootnote}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  className="inline-flex w-full rounded-lg border border-border bg-card p-1 shadow-sm sm:w-auto"
                  role="group"
                  aria-label={copy.labels.pricingPeriod}
                >
                  {pricingPeriodOptions.map((period) => {
                    const selected = pricingPeriod === period
                    return (
                      <button
                        key={period}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectPricingPeriod(period)}
                        className={cn(
                          'min-h-10 flex-1 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-w-28',
                          selected
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {pricingPeriodLabel(copy, period)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4" data-landing-stagger>
                {publicPricingPlans.map((plan) => (
                  <PricingCard
                    key={plan.code}
                    plan={plan}
                    content={copy.pricingContent[plan.code]}
                    copy={copy}
                    locale={locale}
                    period={pricingPeriod}
                    trialHref={trialHref}
                    activationHref={activationHref}
                    ctaLabel={primaryCtaLabel}
                  />
                ))}
              </div>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24 bg-background py-16 lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
              <SectionIntro title={copy.faqTitle} body={copy.faqBody} />
              <div className="grid gap-3 md:grid-cols-2" data-landing-stagger>
                {copy.faqs.map((item) => (
                  <Card key={item.question} className="border-border/70 bg-card shadow-sm">
                    <CardContent className="px-5 pb-5 pt-6 sm:p-6">
                      <div className="flex gap-4">
                        <InlineSurfaceIcon name="question" className="mt-0.5 h-5 w-5" />
                        <div className="min-w-0">
                          <h3 className="font-semibold leading-tight">{item.question}</h3>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.answer}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section id="team" className="scroll-mt-24 border-y border-border/70 bg-card py-16 lg:py-24">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:items-start lg:px-8">
              <div>
                <SectionIntro title={copy.teamTitle} body={copy.teamBody} />
                <div className="mt-6 rounded-lg border border-border bg-background p-4 shadow-sm sm:p-5">
                  <div className="grid gap-4">
                    <div className="flex h-28 w-full items-center justify-center rounded-lg border border-border bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950 sm:h-32">
                      <img
                        src="/brand/wisecore-logo-light.png"
                        alt="WiseCore Technologies, Lda."
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain dark:hidden"
                      />
                      <img
                        src="/brand/wisecore-logo-dark.png"
                        alt="WiseCore Technologies, Lda."
                        loading="lazy"
                        decoding="async"
                        className="hidden h-full w-full object-contain dark:block"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase text-primary">{copy.labels.builtBy}</div>
                      <div className="mt-1 text-lg font-semibold">{copy.labels.wiseCore}</div>
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <InlineSurfaceIcon name="company" className="h-4 w-4" />
                        <span>{copy.labels.office}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" data-landing-stagger>
                {copy.teamMembers.map((member) => (
                  <div key={member.name} className="landing-hover-lift rounded-lg border border-border bg-background p-5 shadow-sm">
                    <h3 className="text-xl font-semibold leading-tight">{member.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-primary">{member.role}</p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{member.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="border-t border-slate-800 bg-slate-950 py-16 text-white lg:py-20">
            <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">{copy.finalTitle}</h2>
                <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">{copy.finalBody}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link to={trialHref}>
                    {primaryCtaLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" asChild>
                  <a href={contactHref}>
                    {copy.finalSecondary}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-border/70 bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
            <div className="max-w-md">
              <BrandLockup subtitle={copy.footerTagline} />
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <InlineSurfaceIcon name="company" className="h-4 w-4" />
                <span>{copy.labels.wiseCore}</span>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:text-right">
              <div className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
                {copy.nav.map((item) => (
                  <a key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </a>
                ))}
                <Link to={signInHref} className="transition-colors hover:text-foreground">
                  {signInLabel}
                </Link>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
                <span>
                  {copy.labels.supportEmail}: {PUBLIC_CONTACT_EMAIL}
                </span>
                <a href={contactHref} className="transition-colors hover:text-foreground">
                  {copy.labels.talkToUs}
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}
