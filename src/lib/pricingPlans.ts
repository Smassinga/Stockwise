export type PublicPricingPlan = {
  code: string
  name: string
  tagline: string
  idealFor: string
  monthlyMzn?: number | null
  sixMonthMzn?: number | null
  annualMzn: number
  onboardingMzn?: number | null
  startingAnnualMzn?: number | null
  annualSavingMzn?: number | null
  companyAccountLabel?: string | null
  userLimitLabel?: string | null
  highlight?: boolean
}

export const publicPricingPlans: PublicPricingPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    tagline: 'The clean entry point for businesses leaving spreadsheets behind.',
    idealFor: 'Smaller businesses that need stock, orders, customers, and suppliers under control.',
    monthlyMzn: 2001,
    sixMonthMzn: 11385,
    annualMzn: 20010,
    onboardingMzn: 5175,
    annualSavingMzn: 4002,
    companyAccountLabel: '1 company account',
    userLimitLabel: 'Up to 2 users',
  },
  {
    code: 'growth',
    name: 'Growth',
    tagline: 'The most balanced plan for growing operational teams.',
    idealFor: 'Growing companies that need stronger reporting, follow-up, and implementation guidance.',
    monthlyMzn: 3381,
    sixMonthMzn: 19251,
    annualMzn: 33810,
    onboardingMzn: 10350,
    annualSavingMzn: 6762,
    companyAccountLabel: '1 company account',
    userLimitLabel: 'Up to 5 users',
    highlight: true,
  },
  {
    code: 'business',
    name: 'Business',
    tagline: 'For heavier daily operations that need stronger handling and more support.',
    idealFor: 'Established teams with more users, more complex workflows, and tighter day-to-day execution needs.',
    monthlyMzn: 5451,
    sixMonthMzn: 31050,
    annualMzn: 54510,
    onboardingMzn: 17250,
    annualSavingMzn: 10902,
    companyAccountLabel: '1 company account',
    userLimitLabel: 'Up to 10 users',
  },
  {
    code: 'managed_business_plus',
    name: 'Managed Business+',
    tagline: 'A managed relationship with more oversight, reinforcement, and operational support.',
    idealFor: 'Businesses that want a closer operating relationship and more hands-on guidance across the year.',
    annualMzn: 82800,
    startingAnnualMzn: 82800,
    companyAccountLabel: 'Business plan access',
    userLimitLabel: 'User scope by proposal',
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
  if (value == null || !Number.isFinite(Number(value))) return '--'
  return `${Number(value).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} MZN`
}
