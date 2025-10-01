import Logo from '../brand/Logo'

type Props = {
  companyName?: string | null
  logoUrl?: string | null
  fallbackName?: string | null
  rightSlot?: React.ReactNode
  className?: string
}

export default function DocHeader({ companyName, fallbackName, logoUrl, rightSlot, className }: Props) {
  const name = (companyName ?? '').trim() || (fallbackName ?? '').trim() || '—'

  return (
    <div className={`flex items-center justify-between gap-6 border-b pb-4 mb-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        {/* Your Logo component will render the SVG mark automatically if src is empty */}
        <Logo src={logoUrl || undefined} h={40} alt={name} />
        <div className="text-base font-semibold">{name}</div>
      </div>
      <div className="text-right">{rightSlot}</div>
    </div>
  )
}
