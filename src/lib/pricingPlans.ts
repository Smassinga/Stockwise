export type PublicPricingPlan = {
  code: string
  name: string
  tagline: string
  monthlyMzn?: number | null
  sixMonthMzn?: number | null
  annualMzn: number
  onboardingMzn?: number | null
  startingAnnualMzn?: number | null
  highlight?: boolean
}

export const publicPricingPlans: PublicPricingPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    tagline: 'Core stock, orders, and daily finance visibility for a focused operating team.',
    monthlyMzn: 2001,
    sixMonthMzn: 11385,
    annualMzn: 20010,
    onboardingMzn: 5175,
  },
  {
    code: 'growth',
    name: 'Growth',
    tagline: 'For teams expanding workflow control across more locations, users, and finance volume.',
    monthlyMzn: 3381,
    sixMonthMzn: 19251,
    annualMzn: 33810,
    onboardingMzn: 10350,
    highlight: true,
  },
  {
    code: 'business',
    name: 'Business',
    tagline: 'For finance-heavy operations that need tighter execution discipline and broader control.',
    monthlyMzn: 5451,
    sixMonthMzn: 31050,
    annualMzn: 54510,
    onboardingMzn: 17250,
  },
  {
    code: 'managed_business_plus',
    name: 'Managed Business+',
    tagline: 'High-touch rollout, operational oversight, and managed enablement for larger deployments.',
    annualMzn: 82800,
    startingAnnualMzn: 82800,
  },
]

export const internalPlanOptions = [
  { code: 'trial_7d', name: '7-day Trial' },
  { code: 'starter', name: 'Starter' },
  { code: 'growth', name: 'Growth' },
  { code: 'business', name: 'Business' },
  { code: 'managed_business_plus', name: 'Managed Business+' },
  { code: 'legacy_manual', name: 'Legacy Manual Access' },
] as const

export function formatMzn(value: number | null | undefined, locale: string = 'en-MZ') {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} MZN`
}
