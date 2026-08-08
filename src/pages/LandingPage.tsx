import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import Logo from '../components/brand/Logo'
import { LandingFaq } from '../components/landing/LandingFaq'
import LocaleToggle from '../components/LocaleToggle'
import ThemeToggle from '../components/ThemeToggle'
import { Button } from '../components/ui/button'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../lib/i18n'
import { buildPublicMailto, PUBLIC_CONTACT_EMAIL } from '../lib/publicContact'
import { formatMzn, publicPricingPlans, type PublicPricingPlan } from '../lib/pricingPlans'
import { cn } from '../lib/utils'

type Lang = 'en' | 'pt'
type PricingPeriod = 'monthly' | 'six_month' | 'annual'

type PlanContent = {
  headline: string
  included: string[]
  support: string[]
}

type LandingCopy = {
  nav: Array<{ label: string; href: string }>
  heroTitle: string
  heroBody: string
  heroImageAlt: string
  heroImageCaption: string
  primaryCta: string
  secondaryCta: string
  activationNote: string
  signIn: string
  openDashboard: string
  openMenu: string
  closeMenu: string
  chainTitle: string
  chain: string[]
  fitTitle: string
  fitBody: string
  operationFits: Array<{ title: string; body: string }>
  evidenceTitle: string
  evidence: Array<{ title: string; body: string }>
  problemTitle: string
  problemBody: string
  problems: Array<{ title: string; body: string }>
  capabilitiesTitle: string
  capabilitiesBody: string
  capabilityStories: Array<{ number: string; title: string; body: string; points: string[] }>
  traceTitle: string
  traceBody: string
  traces: Array<{ title: string; steps: string[]; note: string }>
  workflowTitle: string
  workflowBody: string
  workflowSteps: Array<{ title: string; body: string }>
  useCasesTitle: string
  useCasesBody: string
  useCases: Array<{ title: string; body: string }>
  pricingTitle: string
  pricingBody: string
  pricingFootnote: string
  faqTitle: string
  faqBody: string
  faqs: Array<{ id: string; question: string; answer: string }>
  teamTitle: string
  teamMembers: Array<{ name: string; role: string }>
  finalTitle: string
  finalBody: string
  footerTagline: string
  pricingContent: Record<string, PlanContent>
  labels: {
    monthly: string
    sixMonth: string
    annual: string
    pricingPeriod: string
    perMonth: string
    everySixMonths: string
    perYear: string
    billedMonthly: string
    equivalentMonthly: (amount: string) => string
    saveEverySixMonths: (amount: string) => string
    saveAnnually: (amount: string) => string
    contactUs: string
    billingByProposal: string
    onboarding: string
    includes: string
    support: string
    users: string
    company: string
    recommended: string
    requestActivation: string
    talkToUs: string
    office: string
    builtBy: string
  }
  mailSubjects: {
    activation: string
    contact: string
  }
}

const PRICING_PERIOD_STORAGE_KEY = 'stockwise:landing:pricing-period'
const pricingPeriodOptions: PricingPeriod[] = ['monthly', 'six_month', 'annual']

const copyByLang: Record<Lang, LandingCopy> = {
  en: {
    nav: [
      { label: 'How it works', href: '#operations' },
      { label: 'Use cases', href: '#use-cases' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
    heroTitle: 'Know what you have, what sold, and what needs attention.',
    heroBody:
      'Connect purchases, receipts, stock, production or sales, documents and settlements so one operation can be reviewed from end to end.',
    heroImageAlt:
      'Illustrative desk with inventory sheets, purchase and sales documents, receipts, payment notes and a calculator.',
    heroImageCaption: 'Illustrative operating records — not customer or live product data.',
    primaryCta: 'Start 7-day trial',
    secondaryCta: 'See how records connect',
    activationNote: 'Paid access is activated manually after commercial review. There is no instant paid checkout.',
    signIn: 'Sign in',
    openDashboard: 'Open dashboard',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    chainTitle: 'One operating record should lead to the next',
    chain: ['Purchase', 'Receive', 'Stock', 'Produce or sell', 'Document', 'Settle', 'Review'],
    fitTitle: 'Built around the work, not a list of modules.',
    fitBody:
      'Different operations use different parts of StockWise. The common need is to keep quantities, documents and follow-up connected.',
    operationFits: [
      {
        title: 'Retail and resale',
        body: 'Receive items, sell through Point of Sale or orders, and keep stock availability close to the sales record.',
      },
      {
        title: 'Production and transformation',
        body: 'Record material inputs, production runs and finished output without losing the underlying stock trail.',
      },
      {
        title: 'Growth batches',
        body: 'Follow active batches, measurements, direct costs, stock inputs and event-specific reversals.',
      },
      {
        title: 'Counter sales and daily review',
        body: 'Keep Point of Sale activity, stock movement, users, cash and bank context available for management review.',
      },
    ],
    evidenceTitle: 'Concrete product truths',
    evidence: [
      {
        title: 'Connected records',
        body: 'Purchases, movements, sales, documents and settlements retain their operating context.',
      },
      {
        title: 'Controlled access',
        body: 'Owners, managers and operators work through defined user roles and company access.',
      },
      {
        title: 'Traceable movements',
        body: 'Stock changes remain visible as movements rather than unexplained quantity edits.',
      },
      {
        title: 'Portuguese and English',
        body: 'The interface supports both languages for teams that need them.',
      },
    ],
    problemTitle: 'When records are separate, the answer arrives late.',
    problemBody:
      'Not every business has every problem. These are common points where disconnected records make an ordinary decision harder than it should be.',
    problems: [
      {
        title: 'Low stock is discovered after someone calls.',
        body: 'The quantity in a sheet, a notebook and the actual shelf no longer tells the same story.',
      },
      {
        title: 'Sales, purchases and stock are recorded separately.',
        body: 'A manager can see activity, but cannot quickly explain how that activity changed availability.',
      },
      {
        title: 'A stock change has no clear reason attached.',
        body: 'Receipts, issues, corrections and reversals become difficult to distinguish during review.',
      },
      {
        title: 'One operating question requires several sources.',
        body: 'Documents, messages, spreadsheets and payment notes must be assembled before a decision can be made.',
      },
    ],
    capabilitiesTitle: 'Four operating stories, one connected workspace.',
    capabilitiesBody:
      'StockWise is broad, but the value is not the number of screens. It is the relationship between what happened and what management can verify next.',
    capabilityStories: [
      {
        number: '01',
        title: 'Know what exists and where.',
        body: 'Review items, warehouses, stock levels, minimum-stock signals and the movements that explain a quantity.',
        points: ['Items and warehouses', 'On-hand and minimum stock', 'Receipts, issues, transfers and corrections'],
      },
      {
        number: '02',
        title: 'Connect purchases, stock and sales.',
        body: 'Follow the operating path from buying and receiving through Point of Sale or sales-order activity.',
        points: ['Purchase orders and receiving', 'Point of Sale and sales orders', 'Customer and supplier records'],
      },
      {
        number: '03',
        title: 'Record production and active growth.',
        body: 'Use production runs or Growth Batches where the operation transforms materials or follows biological activity.',
        points: ['Materials and finished output', 'Measurements and direct costs', 'Stock inputs and controlled reversals'],
      },
      {
        number: '04',
        title: 'Keep documents and settlement close to the activity.',
        body: 'Review invoices, notes, vendor obligations, cash, bank and settlement status with the operating record in view.',
        points: ['Sales and supplier documents', 'Open, partial and paid status', 'Reports and management review'],
      },
    ],
    traceTitle: 'Significant activity stays explainable.',
    traceBody:
      'The exact path depends on the workflow. StockWise keeps the records required to follow selling and purchasing activity without presenting every event as an isolated entry.',
    traces: [
      {
        title: 'Selling path',
        steps: ['Sale or order', 'Stock movement', 'Sales document', 'Settlement', 'Review'],
        note: 'See what was sold, what moved, which document carries the obligation and what remains open.',
      },
      {
        title: 'Purchasing path',
        steps: ['Purchase order', 'Receipt', 'Stock', 'Supplier obligation', 'Payment'],
        note: 'Follow what was ordered, what arrived, what entered stock and what is still owed.',
      },
    ],
    workflowTitle: 'Implementation follows the first operating cycle.',
    workflowBody:
      'Setup is guided and paid activation remains manual. The sequence starts with the current process and ends with a reviewed first cycle.',
    workflowSteps: [
      { title: 'Review the current process', body: 'Identify how stock, sales, purchases, documents and payments are handled today.' },
      { title: 'Configure the workspace', body: 'Set up the company, users, roles, warehouses and operating preferences.' },
      { title: 'Prepare starting data', body: 'Add or import items, customers, suppliers and opening stock.' },
      { title: 'Train the team', body: 'Focus each user on the workflows that belong to their role.' },
      { title: 'Review the first cycle', body: 'Confirm that quantities, documents and follow-up reflect the real operation.' },
    ],
    useCasesTitle: 'Useful where the record must follow the work.',
    useCasesBody: 'The operating model matters more than the industry label.',
    useCases: [
      {
        title: 'Bakery or small producer',
        body: 'Connect purchasing, material stock, production runs, finished goods and counter sales.',
      },
      {
        title: 'Food retail or butchery',
        body: 'Keep receiving, stock movements, counter sales and low-stock review in one operating view.',
      },
      {
        title: 'Agro, nursery or biological growth',
        body: 'Use active Growth Batches for measurements, direct costs, stock inputs and reversal evidence.',
      },
      {
        title: 'Warehouse or distributor',
        body: 'Control ordering, receiving, movement, sales and stock risk across operating locations.',
      },
    ],
    pricingTitle: 'Published plans. Controlled activation.',
    pricingBody: 'Choose the operating depth, user scope and implementation support that fit the team.',
    pricingFootnote:
      'Every new company can begin with a 7-day trial. Paid access is activated manually after review; self-serve paid checkout is not active.',
    faqTitle: 'Questions that matter before starting',
    faqBody: 'Direct answers about access, implementation and daily use.',
    faqs: [
      {
        id: 'trial',
        question: 'Can I start the trial without paid activation?',
        answer: 'Yes. A new company can begin with a 7-day trial. Paid access is activated manually after the trial or commercial review.',
      },
      {
        id: 'activation',
        question: 'What happens when the trial ends?',
        answer: 'The StockWise team reviews the plan and activation with you. The landing page does not provide instant paid checkout.',
      },
      {
        id: 'implementation',
        question: 'How is implementation handled?',
        answer: 'Implementation starts with the current process, workspace configuration and starting data, followed by role-focused training and review of the first operating cycle.',
      },
      {
        id: 'import',
        question: 'Can I import items and opening stock?',
        answer: 'Yes. StockWise includes an opening-data workflow for items and starting stock, with validation before the records are accepted.',
      },
      {
        id: 'team',
        question: 'Can several people use the same company workspace?',
        answer: 'Yes. Plans define user scope, and the product supports company users with controlled roles for different responsibilities.',
      },
      {
        id: 'mobile',
        question: 'Can the team work from a phone?',
        answer: 'The web application is responsive and Android access is supported. The appropriate workflow still depends on the role and task.',
      },
      {
        id: 'accountant',
        question: 'Does StockWise replace accounting advice?',
        answer: 'No. StockWise organises operational and finance records for review. Official submissions and accounting decisions should be validated by the appropriate professional.',
      },
    ],
    teamTitle: 'StockWise is built by WiseCore Technologies.',
    teamMembers: [
      { name: 'Samuel Massinga', role: 'Founder and CEO' },
      { name: 'Alda Jofrice', role: 'Co-Founder and Executive Manager' },
      { name: 'Galileu Gonçalves', role: 'Co-Founder and Chief Operating Officer' },
    ],
    finalTitle: 'Start with one operating cycle.',
    finalBody: 'Use the 7-day trial to see whether StockWise makes the records your team already handles easier to follow.',
    footerTagline: 'Connected operational records for stock, sales, purchasing, production, documents and settlement review.',
    pricingContent: {
      starter: {
        headline: 'For smaller teams moving stock and orders out of spreadsheets.',
        included: ['Product and stock management', 'Sales and purchase orders', 'Customer and supplier records', 'Basic dashboards and reporting'],
        support: ['Initial setup support', 'Up to 1 week of remote training', 'Standard remote business-hours support'],
      },
      growth: {
        headline: 'For growing teams that need stronger visibility and follow-up.',
        included: ['Everything in Starter', 'Enhanced reporting and dashboard visibility', 'Improved balance and activity follow-up'],
        support: ['Priority remote support', 'Up to 2 weeks of remote training', 'Additional implementation guidance'],
      },
      business: {
        headline: 'For heavier daily operations with more users and operating complexity.',
        included: ['Everything in Growth', 'Up to 10 users', 'A better fit for complex daily operations'],
        support: ['Faster support handling', 'More hands-on onboarding', 'Periodic adoption review and guidance'],
      },
      managed_business_plus: {
        headline: 'For teams that want a closer operating and support relationship.',
        included: ['Business plan access', 'Managed onboarding approach', 'Refresher training sessions'],
        support: ['Periodic review meetings', 'Higher support priority', 'Hands-on adoption and stabilisation support'],
      },
    },
    labels: {
      monthly: 'Monthly',
      sixMonth: '6 months',
      annual: 'Annual',
      pricingPeriod: 'Pricing period',
      perMonth: 'per month',
      everySixMonths: 'every 6 months',
      perYear: 'per year',
      billedMonthly: 'Billed monthly',
      equivalentMonthly: (amount) => `${amount} monthly equivalent`,
      saveEverySixMonths: (amount) => `Save ${amount} every 6 months`,
      saveAnnually: (amount) => `Save ${amount} annually`,
      contactUs: 'Contact us',
      billingByProposal: 'Annual pricing and scope by proposal',
      onboarding: 'Onboarding',
      includes: 'Plan scope',
      support: 'Implementation and support',
      users: 'Users',
      company: 'Company',
      recommended: 'Recommended operating fit',
      requestActivation: 'Request activation',
      talkToUs: 'Talk to StockWise',
      office: 'Beira, Mozambique',
      builtBy: 'A WiseCore Technologies, Lda. product',
    },
    mailSubjects: {
      activation: 'StockWise activation request',
      contact: 'StockWise commercial conversation',
    },
  },
  pt: {
    nav: [
      { label: 'Como funciona', href: '#operations' },
      { label: 'Casos de uso', href: '#use-cases' },
      { label: 'Preços', href: '#pricing' },
      { label: 'Perguntas', href: '#faq' },
    ],
    heroTitle: 'Saiba o que tem, o que vendeu e o que precisa de atenção.',
    heroBody:
      'Ligue compras, recepção, stock, produção ou vendas, documentos e liquidações para rever cada operação de princípio ao fim.',
    heroImageAlt:
      'Mesa ilustrativa com folhas de inventário, documentos de compra e venda, recibos, notas de pagamento e calculadora.',
    heroImageCaption: 'Registos operacionais ilustrativos — não são dados de clientes nem dados reais do produto.',
    primaryCta: 'Começar teste de 7 dias',
    secondaryCta: 'Ver como os registos se ligam',
    activationNote: 'O acesso pago é activado manualmente depois da revisão comercial. Não existe checkout pago imediato.',
    signIn: 'Entrar',
    openDashboard: 'Abrir dashboard',
    openMenu: 'Abrir menu',
    closeMenu: 'Fechar menu',
    chainTitle: 'Um registo operacional deve levar ao seguinte',
    chain: ['Comprar', 'Receber', 'Stock', 'Produzir ou vender', 'Documentar', 'Liquidar', 'Rever'],
    fitTitle: 'Organizado pelo trabalho, não por uma lista de módulos.',
    fitBody:
      'Operações diferentes usam partes diferentes do StockWise. A necessidade comum é manter quantidades, documentos e seguimento ligados.',
    operationFits: [
      {
        title: 'Retalho e revenda',
        body: 'Receba artigos, venda no Ponto de Venda ou por encomenda e mantenha a disponibilidade próxima do registo de venda.',
      },
      {
        title: 'Produção e transformação',
        body: 'Registe matérias-primas, ordens de produção e produto acabado sem perder o rasto do stock.',
      },
      {
        title: 'Lotes de crescimento',
        body: 'Acompanhe lotes activos, medições, custos directos, entradas de stock e reversões específicas por evento.',
      },
      {
        title: 'Vendas ao balcão e revisão diária',
        body: 'Mantenha o Ponto de Venda, movimentos, utilizadores, caixa e banco disponíveis para revisão da gestão.',
      },
    ],
    evidenceTitle: 'Factos concretos do produto',
    evidence: [
      {
        title: 'Registos ligados',
        body: 'Compras, movimentos, vendas, documentos e liquidações mantêm o seu contexto operacional.',
      },
      {
        title: 'Acesso controlado',
        body: 'Proprietários, gestores e operadores trabalham com funções e acesso por empresa definidos.',
      },
      {
        title: 'Movimentos rastreáveis',
        body: 'Alterações de stock permanecem visíveis como movimentos, e não como quantidades sem explicação.',
      },
      {
        title: 'Português e inglês',
        body: 'A interface suporta os dois idiomas para equipas que precisam deles.',
      },
    ],
    problemTitle: 'Quando os registos estão separados, a resposta chega tarde.',
    problemBody:
      'Nem todos os negócios têm todos estes problemas. São pontos comuns onde registos desligados tornam uma decisão normal mais difícil do que deveria.',
    problems: [
      {
        title: 'O stock baixo só é descoberto depois de alguém ligar.',
        body: 'A quantidade na folha, no caderno e na prateleira deixou de contar a mesma história.',
      },
      {
        title: 'Vendas, compras e stock são registados separadamente.',
        body: 'O gestor vê actividade, mas não consegue explicar rapidamente como ela alterou a disponibilidade.',
      },
      {
        title: 'Uma alteração de stock não tem motivo claro.',
        body: 'Recepções, saídas, correcções e reversões tornam-se difíceis de distinguir durante a revisão.',
      },
      {
        title: 'Uma pergunta operacional exige várias fontes.',
        body: 'Documentos, mensagens, folhas e notas de pagamento precisam de ser reunidos antes de decidir.',
      },
    ],
    capabilitiesTitle: 'Quatro histórias operacionais, um workspace ligado.',
    capabilitiesBody:
      'O StockWise é abrangente, mas o valor não está no número de ecrãs. Está na relação entre o que aconteceu e o que a gestão consegue verificar a seguir.',
    capabilityStories: [
      {
        number: '01',
        title: 'Saiba o que existe e onde está.',
        body: 'Reveja artigos, armazéns, níveis de stock, mínimos e os movimentos que explicam cada quantidade.',
        points: ['Artigos e armazéns', 'Stock disponível e mínimo', 'Recepções, saídas, transferências e correcções'],
      },
      {
        number: '02',
        title: 'Ligue compras, stock e vendas.',
        body: 'Siga o percurso operacional desde a compra e recepção até ao Ponto de Venda ou encomenda de venda.',
        points: ['Ordens de compra e recepção', 'Ponto de Venda e encomendas', 'Registos de clientes e fornecedores'],
      },
      {
        number: '03',
        title: 'Registe produção e crescimento activo.',
        body: 'Use Produção ou Lotes de Crescimento quando a operação transforma materiais ou acompanha actividade biológica.',
        points: ['Materiais e produto acabado', 'Medições e custos directos', 'Entradas de stock e reversões controladas'],
      },
      {
        number: '04',
        title: 'Mantenha documentos e liquidação próximos da actividade.',
        body: 'Reveja documentos, obrigações a fornecedores, caixa, banco e estado da liquidação com o registo operacional à vista.',
        points: ['Documentos de venda e fornecedor', 'Estado aberto, parcial e pago', 'Relatórios e revisão da gestão'],
      },
    ],
    traceTitle: 'A actividade importante continua explicável.',
    traceBody:
      'O percurso exacto depende do processo. O StockWise mantém os registos necessários para seguir vendas e compras sem apresentar cada evento como uma entrada isolada.',
    traces: [
      {
        title: 'Percurso da venda',
        steps: ['Venda ou encomenda', 'Movimento de stock', 'Documento de venda', 'Liquidação', 'Revisão'],
        note: 'Veja o que foi vendido, o que movimentou, qual documento suporta a obrigação e o que permanece aberto.',
      },
      {
        title: 'Percurso da compra',
        steps: ['Ordem de compra', 'Recepção', 'Stock', 'Obrigação ao fornecedor', 'Pagamento'],
        note: 'Siga o que foi encomendado, o que chegou, o que entrou em stock e o que ainda falta pagar.',
      },
    ],
    workflowTitle: 'A implementação acompanha o primeiro ciclo operacional.',
    workflowBody:
      'A configuração é orientada e a activação paga continua manual. A sequência começa no processo actual e termina com a revisão do primeiro ciclo.',
    workflowSteps: [
      { title: 'Rever o processo actual', body: 'Identificar como stock, vendas, compras, documentos e pagamentos são tratados hoje.' },
      { title: 'Configurar o workspace', body: 'Preparar empresa, utilizadores, funções, armazéns e preferências operacionais.' },
      { title: 'Preparar os dados iniciais', body: 'Adicionar ou importar artigos, clientes, fornecedores e stock de abertura.' },
      { title: 'Formar a equipa', body: 'Concentrar cada utilizador nos processos que pertencem à sua função.' },
      { title: 'Rever o primeiro ciclo', body: 'Confirmar que quantidades, documentos e seguimento representam a operação real.' },
    ],
    useCasesTitle: 'Útil onde o registo precisa de acompanhar o trabalho.',
    useCasesBody: 'O modelo operacional importa mais do que o nome do sector.',
    useCases: [
      {
        title: 'Padaria ou pequena produção',
        body: 'Ligue compras, matérias-primas, produção, produto acabado e vendas ao balcão.',
      },
      {
        title: 'Retalho alimentar ou talho',
        body: 'Mantenha recepção, movimentos, vendas ao balcão e revisão de stock baixo no mesmo controlo.',
      },
      {
        title: 'Agro, viveiro ou crescimento biológico',
        body: 'Use Lotes de Crescimento activos para medições, custos directos, entradas de stock e reversões.',
      },
      {
        title: 'Armazém ou distribuidor',
        body: 'Controle encomenda, recepção, movimentos, vendas e risco de stock entre locais operacionais.',
      },
    ],
    pricingTitle: 'Planos publicados. Activação controlada.',
    pricingBody: 'Escolha a profundidade operacional, o número de utilizadores e o apoio de implementação adequados à equipa.',
    pricingFootnote:
      'Cada nova empresa pode começar com um teste de 7 dias. O acesso pago é activado manualmente depois da revisão; não existe checkout pago automático.',
    faqTitle: 'Perguntas importantes antes de começar',
    faqBody: 'Respostas directas sobre acesso, implementação e uso diário.',
    faqs: [
      {
        id: 'trial',
        question: 'Posso começar o teste sem activação paga?',
        answer: 'Sim. Uma nova empresa pode começar com um teste de 7 dias. O acesso pago é activado manualmente depois do teste ou da revisão comercial.',
      },
      {
        id: 'activation',
        question: 'O que acontece quando o teste termina?',
        answer: 'A equipa StockWise revê consigo o plano e a activação. A Landing Page não oferece checkout pago imediato.',
      },
      {
        id: 'implementation',
        question: 'Como é feita a implementação?',
        answer: 'A implementação começa no processo actual, passa pela configuração e dados iniciais, e continua com formação por função e revisão do primeiro ciclo operacional.',
      },
      {
        id: 'import',
        question: 'Posso importar artigos e stock de abertura?',
        answer: 'Sim. O StockWise inclui um processo de dados iniciais para artigos e stock de abertura, com validação antes de aceitar os registos.',
      },
      {
        id: 'team',
        question: 'Várias pessoas podem usar o mesmo workspace?',
        answer: 'Sim. Os planos definem o número de utilizadores e o produto suporta utilizadores da empresa com funções controladas para responsabilidades diferentes.',
      },
      {
        id: 'mobile',
        question: 'A equipa pode trabalhar pelo telefone?',
        answer: 'A aplicação web é responsiva e existe acesso Android. O processo adequado continua a depender da função e da tarefa.',
      },
      {
        id: 'accountant',
        question: 'O StockWise substitui o aconselhamento contabilístico?',
        answer: 'Não. O StockWise organiza registos operacionais e financeiros para revisão. Submissões oficiais e decisões contabilísticas devem ser validadas pelo profissional adequado.',
      },
    ],
    teamTitle: 'O StockWise é desenvolvido pela WiseCore Technologies.',
    teamMembers: [
      { name: 'Samuel Massinga', role: 'Fundador e CEO' },
      { name: 'Alda Jofrice', role: 'Co-Fundadora e Gestora Executiva' },
      { name: 'Galileu Gonçalves', role: 'Co-Fundador e Director de Operações' },
    ],
    finalTitle: 'Comece com um ciclo operacional.',
    finalBody: 'Use o teste de 7 dias para perceber se o StockWise torna os registos que a sua equipa já trata mais fáceis de seguir.',
    footerTagline: 'Registos operacionais ligados para stock, vendas, compras, produção, documentos e revisão de liquidações.',
    pricingContent: {
      starter: {
        headline: 'Para equipas pequenas que querem tirar stock e encomendas das folhas soltas.',
        included: ['Gestão de produtos e stock', 'Encomendas de venda e ordens de compra', 'Clientes e fornecedores', 'Dashboards e relatórios base'],
        support: ['Suporte inicial de configuração', 'Até 1 semana de formação remota', 'Suporte remoto padrão no horário de trabalho'],
      },
      growth: {
        headline: 'Para equipas em crescimento que precisam de mais visibilidade e seguimento.',
        included: ['Tudo do Starter', 'Dashboards e relatórios mais completos', 'Melhor seguimento de saldos e actividade'],
        support: ['Suporte remoto prioritário', 'Até 2 semanas de formação remota', 'Orientação adicional de implementação'],
      },
      business: {
        headline: 'Para operações diárias mais pesadas, com mais utilizadores e complexidade.',
        included: ['Tudo do Growth', 'Até 10 utilizadores', 'Melhor ajuste para operações diárias complexas'],
        support: ['Tratamento de suporte mais rápido', 'Onboarding mais acompanhado', 'Revisão e orientação periódica da adopção'],
      },
      managed_business_plus: {
        headline: 'Para equipas que querem uma relação operacional e de suporte mais próxima.',
        included: ['Acesso ao plano Business', 'Implementação acompanhada', 'Sessões de formação de reforço'],
        support: ['Reuniões periódicas de revisão', 'Prioridade de suporte mais alta', 'Apoio próximo durante adopção e estabilização'],
      },
    },
    labels: {
      monthly: 'Mensal',
      sixMonth: '6 meses',
      annual: 'Anual',
      pricingPeriod: 'Período de preço',
      perMonth: 'por mês',
      everySixMonths: 'a cada 6 meses',
      perYear: 'por ano',
      billedMonthly: 'Facturado mensalmente',
      equivalentMonthly: (amount) => `Equivalente mensal de ${amount}`,
      saveEverySixMonths: (amount) => `Poupe ${amount} a cada 6 meses`,
      saveAnnually: (amount) => `Poupe ${amount} por ano`,
      contactUs: 'Fale connosco',
      billingByProposal: 'Preço anual e âmbito por proposta',
      onboarding: 'Implementação',
      includes: 'Âmbito do plano',
      support: 'Implementação e suporte',
      users: 'Utilizadores',
      company: 'Empresa',
      recommended: 'Opção operacional recomendada',
      requestActivation: 'Pedir activação',
      talkToUs: 'Falar com StockWise',
      office: 'Beira, Moçambique',
      builtBy: 'Um produto da WiseCore Technologies, Lda.',
    },
    mailSubjects: {
      activation: 'Pedido de activação StockWise',
      contact: 'Conversa comercial StockWise',
    },
  },
}

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
  managed_business_plus: 'Utilizadores por proposta',
}

function isPricingPeriod(value: string | null): value is PricingPeriod {
  return value === 'monthly' || value === 'six_month' || value === 'annual'
}

function getStoredPricingPeriod(): PricingPeriod {
  if (typeof window === 'undefined') return 'monthly'
  const stored = window.sessionStorage.getItem(PRICING_PERIOD_STORAGE_KEY)
  return isPricingPeriod(stored) ? stored : 'monthly'
}

function pricingPeriodLabel(copy: LandingCopy, period: PricingPeriod) {
  if (period === 'monthly') return copy.labels.monthly
  if (period === 'six_month') return copy.labels.sixMonth
  return copy.labels.annual
}

function pricingDisplayFor(plan: PublicPricingPlan, period: PricingPeriod, locale: string, copy: LandingCopy) {
  if (period === 'monthly') {
    if (plan.monthlyMzn == null) {
      return { price: copy.labels.contactUs, cadence: '', note: copy.labels.billingByProposal, saving: null }
    }
    return {
      price: formatMzn(plan.monthlyMzn, locale),
      cadence: copy.labels.perMonth,
      note: copy.labels.billedMonthly,
      saving: null,
    }
  }

  if (period === 'six_month') {
    const amount = plan.sixMonthMzn ?? (plan.monthlyMzn != null ? plan.monthlyMzn * 6 : null)
    if (amount == null) {
      return { price: copy.labels.contactUs, cadence: '', note: copy.labels.billingByProposal, saving: null }
    }
    const saving = plan.sixMonthMzn != null && plan.monthlyMzn != null
      ? Math.max(0, plan.monthlyMzn * 6 - plan.sixMonthMzn)
      : 0
    return {
      price: formatMzn(amount, locale),
      cadence: copy.labels.everySixMonths,
      note: copy.labels.equivalentMonthly(formatMzn(amount / 6, locale)),
      saving: saving > 0 ? copy.labels.saveEverySixMonths(formatMzn(saving, locale)) : null,
    }
  }

  const annualAmount = plan.startingAnnualMzn ?? plan.annualMzn
  const saving = plan.annualSavingMzn
    ?? (plan.monthlyMzn != null ? Math.max(0, plan.monthlyMzn * 12 - annualAmount) : 0)
  return {
    price: formatMzn(annualAmount, locale),
    cadence: copy.labels.perYear,
    note: copy.labels.equivalentMonthly(formatMzn(annualAmount / 12, locale)),
    saving: saving > 0 ? copy.labels.saveAnnually(formatMzn(saving, locale)) : null,
  }
}

function StructuredData({ lang }: { lang: Lang }) {
  const description = lang === 'pt'
    ? 'O StockWise liga compras, stock, vendas, produção, documentos e liquidações num workspace operacional.'
    : 'StockWise connects purchases, stock, sales, production, documents, and settlements in one operating workspace.'
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://stockwiseapp.com/#organization',
        name: 'WiseCore Technologies, Lda.',
        url: 'https://stockwiseapp.com/',
        logo: 'https://stockwiseapp.com/brand/wisecore-logo-light.png',
        address: { '@type': 'PostalAddress', addressLocality: 'Beira', addressCountry: 'MZ' },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'StockWise',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, Android',
        description,
        url: 'https://stockwiseapp.com/',
        offers: publicPricingPlans.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          priceCurrency: 'MZN',
          price: plan.monthlyMzn ?? plan.annualMzn,
        })),
      },
    ],
  }

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

function SectionHeading({ title, body, inverse = false }: { title: string; body?: string; inverse?: boolean }) {
  return (
    <div className="max-w-3xl">
      <h2 className={cn('text-balance text-3xl font-semibold tracking-tight sm:text-4xl', inverse ? 'text-white' : 'text-foreground')}>
        {title}
      </h2>
      {body ? <p className={cn('mt-4 max-w-2xl text-base leading-7 sm:text-lg', inverse ? 'text-zinc-300' : 'text-muted-foreground')}>{body}</p> : null}
    </div>
  )
}

function FlowSteps({ steps, inverse = false }: { steps: string[]; inverse?: boolean }) {
  return (
    <ol className="grid gap-0 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))]">
      {steps.map((step, index) => (
        <li
          key={step}
          className={cn(
            'relative flex min-h-20 items-center border-t py-4 pr-8 text-sm font-semibold sm:border-t-0 sm:border-l sm:px-5 lg:min-h-24',
            inverse ? 'border-zinc-700 text-white' : 'border-border text-foreground',
          )}
        >
          <span className={cn('mr-3 text-xs tabular-nums', inverse ? 'text-zinc-500' : 'text-muted-foreground')}>
            {String(index + 1).padStart(2, '0')}
          </span>
          {step}
          {index < steps.length - 1 ? (
            <ArrowRight className={cn('absolute right-3 h-4 w-4', inverse ? 'text-zinc-600' : 'text-border')} aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function PricingCard({
  plan,
  period,
  locale,
  lang,
  copy,
  trialHref,
  activationHref,
}: {
  plan: PublicPricingPlan
  period: PricingPeriod
  locale: string
  lang: Lang
  copy: LandingCopy
  trialHref: string
  activationHref: string
}) {
  const content = copy.pricingContent[plan.code]
  const pricing = pricingDisplayFor(plan, period, locale, copy)
  const companyLabel = lang === 'pt'
    ? portuguesePlanCompanyLabels[plan.code] ?? plan.companyAccountLabel
    : plan.companyAccountLabel
  const userLabel = lang === 'pt'
    ? portuguesePlanUserLabels[plan.code] ?? plan.userLimitLabel
    : plan.userLimitLabel

  return (
    <article className={cn('flex h-full flex-col border-t-2 bg-background py-7', plan.highlight ? 'border-primary' : 'border-border')}>
      {plan.highlight ? <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary">{copy.labels.recommended}</div> : null}
      <h3 className="text-2xl font-semibold tracking-tight">{plan.name}</h3>
      <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{content.headline}</p>

      <div className="mt-6 border-y border-border py-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="break-words text-3xl font-semibold tracking-tight">{pricing.price}</span>
          {pricing.cadence ? <span className="text-sm text-muted-foreground">{pricing.cadence}</span> : null}
        </div>
        <div className="mt-2 text-sm text-muted-foreground">{pricing.note}</div>
        {pricing.saving ? <div className="mt-2 text-sm font-medium text-status-success-foreground">{pricing.saving}</div> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 border-b border-border py-4 text-sm">
        <div>
          <dt className="text-muted-foreground">{copy.labels.company}</dt>
          <dd className="mt-1 font-medium">{companyLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.labels.users}</dt>
          <dd className="mt-1 font-medium">{userLabel}</dd>
        </div>
      </dl>

      <div className="grid flex-1 gap-5 py-5 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <h4 className="font-semibold">{copy.labels.includes}</h4>
          <ul className="mt-3 list-disc space-y-2 pl-4 leading-5 text-muted-foreground">
            {content.included.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">{copy.labels.support}</h4>
          <ul className="mt-3 list-disc space-y-2 pl-4 leading-5 text-muted-foreground">
            {content.support.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>

      <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Button asChild className="shadow-none">
          <Link to={trialHref}>{copy.primaryCta}</Link>
        </Button>
        <Button asChild variant="outline" className="shadow-none">
          <a href={activationHref}>{copy.labels.requestActivation}</a>
        </Button>
      </div>
    </article>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const { lang } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pricingPeriod, setPricingPeriod] = useState<PricingPeriod>(getStoredPricingPeriod)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  const copy = copyByLang[lang]
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const trialHref = user ? '/dashboard' : '/login'
  const signInHref = user ? '/dashboard' : '/login'
  const primaryCtaLabel = user ? copy.openDashboard : copy.primaryCta
  const signInLabel = user ? copy.openDashboard : copy.signIn
  const activationHref = useMemo(() => buildPublicMailto(copy.mailSubjects.activation), [copy.mailSubjects.activation])
  const contactHref = useMemo(() => buildPublicMailto(copy.mailSubjects.contact), [copy.mailSubjects.contact])

  const closeMenu = () => setMenuOpen(false)
  const selectPricingPeriod = (period: PricingPeriod) => {
    setPricingPeriod(period)
    if (typeof window !== 'undefined') window.sessionStorage.setItem(PRICING_PERIOD_STORAGE_KEY, period)
  }

  useEffect(() => {
    if (!menuOpen || typeof window === 'undefined') return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      window.requestAnimationFrame(() => menuButtonRef.current?.focus())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <StructuredData lang={lang} />
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="inline-flex min-h-11 items-center" aria-label="StockWise home">
            <span className="inline-flex bg-white px-1.5 py-1">
              <Logo h={31} alt="StockWise" />
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {copy.nav.map((item) => (
              <a key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <LocaleToggle />
            <ThemeToggle />
            <Button variant="ghost" asChild className="shadow-none"><Link to={signInHref}>{signInLabel}</Link></Button>
            <Button asChild className="shadow-none"><Link to={trialHref}>{primaryCtaLabel}</Link></Button>
          </div>

          <div className="flex items-center gap-1 lg:hidden">
            <LocaleToggle className="[&_button]:min-h-11" />
            <div className="[&_button]:!h-11 [&_button]:!w-11">
              <ThemeToggle compact />
            </div>
            <Button
              ref={menuButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shadow-none"
              aria-label={menuOpen ? copy.closeMenu : copy.openMenu}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {menuOpen ? (
          <div id="landing-mobile-menu" className="border-t border-border bg-background px-4 py-4 lg:hidden">
            <nav className="mx-auto grid max-w-7xl gap-1" aria-label="Mobile navigation">
              {copy.nav.map((item) => (
                <a key={item.href} href={item.href} onClick={closeMenu} className="min-h-11 rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted/60">
                  {item.label}
                </a>
              ))}
              <div className="mt-3 grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                <Button variant="outline" asChild className="shadow-none"><Link to={signInHref} onClick={closeMenu}>{signInLabel}</Link></Button>
                <Button asChild className="shadow-none"><Link to={trialHref} onClick={closeMenu}>{primaryCtaLabel}</Link></Button>
              </div>
            </nav>
          </div>
        ) : null}
      </header>

      <main>
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.92fr)_minmax(28rem,1.08fr)] lg:gap-16 lg:px-8 lg:py-24">
            <div>
              <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                {copy.heroTitle}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">{copy.heroBody}</p>
              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Button size="lg" asChild className="min-h-12 shadow-none"><Link to={trialHref}>{primaryCtaLabel}<ArrowRight aria-hidden="true" /></Link></Button>
                <a href="#operations" className="inline-flex min-h-12 items-center justify-center gap-2 px-4 text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary">
                  {copy.secondaryCta}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
              <p className="mt-5 max-w-xl border-l-2 border-primary pl-4 text-sm leading-6 text-muted-foreground">{copy.activationNote}</p>
            </div>

            <figure className="overflow-hidden border border-border bg-black">
              <img
                src="/landing/stockwise-records-desk.png"
                alt={copy.heroImageAlt}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="aspect-[4/3] h-full w-full object-cover"
              />
              <figcaption className="border-t border-zinc-800 bg-black px-4 py-3 text-xs leading-5 text-zinc-400">{copy.heroImageCaption}</figcaption>
            </figure>
          </div>
        </section>

        <section id="operations" className="scroll-mt-24 border-b border-border bg-card">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{copy.chainTitle}</h2>
            <div className="mt-5 overflow-x-auto pb-2">
              <ol className="flex min-w-max items-center" aria-label={copy.chainTitle}>
                {copy.chain.map((step, index) => (
                  <li key={step} className="flex items-center">
                    <span className="py-2 text-base font-semibold">{step}</span>
                    {index < copy.chain.length - 1 ? <ArrowRight className="mx-4 h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-8">
            <SectionHeading title={copy.fitTitle} body={copy.fitBody} />
            <div className="divide-y divide-border border-y border-border">
              {copy.operationFits.map((fit) => (
                <article key={fit.title} className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8">
                  <h3 className="font-semibold">{fit.title}</h3>
                  <p className="leading-7 text-muted-foreground">{fit.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-muted/25 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{copy.evidenceTitle}</h2>
            <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {copy.evidence.map((item) => (
                <div key={item.title} className="border-l border-primary pl-4">
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading title={copy.problemTitle} body={copy.problemBody} />
            <ol className="mt-10 border-t border-border">
              {copy.problems.map((problem, index) => (
                <li key={problem.title} className="grid gap-3 border-b border-border py-7 sm:grid-cols-[4rem_minmax(16rem,0.7fr)_1fr] sm:gap-8">
                  <span className="text-sm tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="text-xl font-semibold leading-7">{problem.title}</h3>
                  <p className="leading-7 text-muted-foreground">{problem.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="capabilities" className="scroll-mt-24 border-b border-border bg-card py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading title={copy.capabilitiesTitle} body={copy.capabilitiesBody} />
            <div className="mt-12 grid border-t border-border lg:grid-cols-2">
              {copy.capabilityStories.map((story, index) => (
                <article key={story.number} className={cn('border-b border-border py-8 lg:px-8', index % 2 === 0 ? 'lg:border-r lg:pl-0' : 'lg:pr-0')}>
                  <div className="text-sm tabular-nums text-primary">{story.number}</div>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight">{story.title}</h3>
                  <p className="mt-3 max-w-xl leading-7 text-muted-foreground">{story.body}</p>
                  <ul className="mt-5 grid gap-2 text-sm font-medium">
                    {story.points.map((point) => <li key={point} className="border-l border-border pl-3">{point}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-black py-16 text-white sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading title={copy.traceTitle} body={copy.traceBody} inverse />
            <div className="mt-12 grid gap-12">
              {copy.traces.map((trace) => (
                <article key={trace.title}>
                  <div className="mb-5 grid gap-2 lg:grid-cols-[14rem_1fr] lg:items-end">
                    <h3 className="text-xl font-semibold">{trace.title}</h3>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">{trace.note}</p>
                  </div>
                  <FlowSteps steps={trace.steps} inverse />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-b border-border py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-8">
            <SectionHeading title={copy.workflowTitle} body={copy.workflowBody} />
            <ol className="border-t border-border">
              {copy.workflowSteps.map((step, index) => (
                <li key={step.title} className="grid gap-3 border-b border-border py-6 sm:grid-cols-[3rem_13rem_1fr] sm:gap-6">
                  <span className="text-sm tabular-nums text-primary">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="use-cases" className="scroll-mt-24 border-b border-border bg-muted/25 py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading title={copy.useCasesTitle} body={copy.useCasesBody} />
            <div className="mt-10 grid border-t border-border sm:grid-cols-2">
              {copy.useCases.map((useCase, index) => (
                <article key={useCase.title} className={cn('border-b border-border py-7 sm:px-6', index % 2 === 0 ? 'sm:border-r sm:pl-0' : 'sm:pr-0')}>
                  <h3 className="text-lg font-semibold">{useCase.title}</h3>
                  <p className="mt-3 max-w-xl leading-7 text-muted-foreground">{useCase.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 border-b border-border py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <SectionHeading title={copy.pricingTitle} body={copy.pricingBody} />
                <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.pricingFootnote}</p>
              </div>
              <div className="flex flex-wrap border-b border-border" role="group" aria-label={copy.labels.pricingPeriod}>
                {pricingPeriodOptions.map((period) => {
                  const selected = pricingPeriod === period
                  return (
                    <button
                      key={period}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectPricingPeriod(period)}
                      className={cn('min-h-11 border-b-2 px-4 py-2 text-sm font-medium', selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                    >
                      {pricingPeriodLabel(copy, period)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-10 grid gap-x-7 gap-y-10 lg:grid-cols-2">
              {publicPricingPlans.map((plan) => (
                <PricingCard
                  key={plan.code}
                  plan={plan}
                  period={pricingPeriod}
                  locale={locale}
                  lang={lang}
                  copy={copy}
                  trialHref={trialHref}
                  activationHref={activationHref}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 border-b border-border bg-card py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-8">
            <SectionHeading title={copy.faqTitle} body={copy.faqBody} />
            <LandingFaq items={copy.faqs} />
          </div>
        </section>

        <section id="team" className="scroll-mt-24 border-b border-border py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-8">
            <div>
              <picture>
                <source media="(prefers-color-scheme: dark)" srcSet="/brand/wisecore-logo-dark.png" />
                <img src="/brand/wisecore-logo-light.png" alt="WiseCore Technologies" className="h-12 w-auto dark:hidden" loading="lazy" />
                <img src="/brand/wisecore-logo-dark.png" alt="" aria-hidden="true" className="hidden h-12 w-auto dark:block" loading="lazy" />
              </picture>
              <h2 className="mt-8 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{copy.teamTitle}</h2>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {copy.teamMembers.map((member) => (
                <div key={member.name} className="grid gap-1 py-5 sm:grid-cols-[1fr_1fr] sm:gap-6">
                  <div className="font-semibold">{member.name}</div>
                  <div className="text-sm text-muted-foreground">{member.role}</div>
                </div>
              ))}
              <div className="grid gap-1 py-5 sm:grid-cols-[1fr_1fr] sm:gap-6">
                <div className="font-semibold">{copy.labels.office}</div>
                <a href={contactHref} className="text-sm font-medium text-primary underline underline-offset-4">{PUBLIC_CONTACT_EMAIL}</a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-black py-16 text-white sm:py-20">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 sm:px-6 lg:flex-row lg:items-end lg:px-8">
            <div>
              <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{copy.finalTitle}</h2>
              <p className="mt-4 max-w-2xl leading-7 text-zinc-300">{copy.finalBody}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button size="lg" asChild className="min-h-12 shadow-none"><Link to={trialHref}>{primaryCtaLabel}<ArrowRight aria-hidden="true" /></Link></Button>
              <Button size="lg" variant="outline" asChild className="min-h-12 border-zinc-600 bg-transparent text-white shadow-none hover:bg-zinc-900 hover:text-white"><a href={contactHref}>{copy.labels.talkToUs}</a></Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-end lg:px-8">
          <div>
            <span className="inline-flex bg-white px-1.5 py-1">
              <Logo h={28} alt="StockWise" />
            </span>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.footerTagline}</p>
            <p className="mt-3 text-xs text-muted-foreground">{copy.labels.builtBy} · {copy.labels.office}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-3 text-sm" aria-label="Footer navigation">
            <a href="#operations" className="text-muted-foreground hover:text-foreground">{copy.nav[0].label}</a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground">{copy.nav[2].label}</a>
            <a href="#faq" className="text-muted-foreground hover:text-foreground">{copy.nav[3].label}</a>
            <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} className="text-muted-foreground hover:text-foreground">{PUBLIC_CONTACT_EMAIL}</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
