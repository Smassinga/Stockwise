import { getMyCompanyAccessState } from './companyAccess'
import { safeNotificationActionUrl } from './notificationPresentation'
import { supabase } from './supabase'

type CompanySwitcher = (companyId: string) => Promise<boolean>

type NotificationNavigationInput = {
  actionUrl: string | null | undefined
  notificationCompanyId: string | null | undefined
  currentCompanyId: string | null | undefined
  userId: string | null | undefined
  setActiveCompany: CompanySwitcher
  verifyCompanyAccess?: (companyId: string, userId: string) => Promise<boolean>
}

async function verifyActiveMembershipAndAccess(companyId: string, userId: string) {
  const { data: membership, error: membershipError } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError || membership?.company_id !== companyId) return false

  try {
    const access = await getMyCompanyAccessState(companyId)
    return access?.company_id === companyId && access.access_enabled === true
  } catch {
    return false
  }
}

/**
 * Revalidates a notification's target company before navigation. Company
 * switching is deliberate and awaited, so a customer deep link can never be
 * opened against whichever company happened to be active previously.
 */
export async function prepareNotificationNavigation({
  actionUrl,
  notificationCompanyId,
  currentCompanyId,
  userId,
  setActiveCompany,
  verifyCompanyAccess = verifyActiveMembershipAndAccess,
}: NotificationNavigationInput) {
  const safeUrl = safeNotificationActionUrl(actionUrl)
  const targetCompanyId = String(notificationCompanyId || '').trim()
  const activeUserId = String(userId || '').trim()
  if (!safeUrl || !targetCompanyId || !activeUserId) return null

  const parsed = new URL(safeUrl, 'https://stockwise.local')
  const companyFromUrl = parsed.searchParams.get('companyId')
  if (companyFromUrl && companyFromUrl !== targetCompanyId) return null

  if (!await verifyCompanyAccess(targetCompanyId, activeUserId)) return null

  if (currentCompanyId !== targetCompanyId) {
    const switched = await setActiveCompany(targetCompanyId)
    if (!switched) return null
  }

  return safeUrl
}
