import { ShieldCheck } from 'lucide-react'
import type { AdministrationAuthority } from '../../lib/administrationPresentation'
import { administrationAuthorityTone } from '../../lib/administrationPresentation'
import { PremiumStatusBadge } from '../premium/PremiumStatusBadge'

type Props = {
  authority: AdministrationAuthority
  label: string
}

export function AdministrationAuthorityBadge({ authority, label }: Props) {
  return (
    <PremiumStatusBadge tone={administrationAuthorityTone(authority)} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
      {label}
    </PremiumStatusBadge>
  )
}
