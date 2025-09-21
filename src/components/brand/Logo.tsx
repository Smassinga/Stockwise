//---------- //src/components/brand/Logo.tsx (NEW) ----------
import * as React from 'react'


type Props = {
/** Tenant-provided logo URL (e.g., from Supabase company_settings.logo_url). */
src?: string | null
/** Desired display height in px; width auto. */
h?: number
/** Accessible label for screen readers. */
alt?: string
}


export default function Logo({ src, h = 40, alt = 'StockWise' }: Props) {
// Auto-detect OS preference to choose an appropriate fallback when no tenant logo
const [isDark, setIsDark] = React.useState(false)
React.useEffect(() => {
if (typeof window === 'undefined' || !window.matchMedia) return
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const apply = () => setIsDark(!!mq.matches)
apply()
if (mq.addEventListener) mq.addEventListener('change', apply)
else mq.addListener(apply)
return () => {
if (mq.removeEventListener) mq.removeEventListener('change', apply)
else mq.removeListener(apply)
}
}, [])


const fallback = isDark ? '/icon-192-dark.png' : '/icon-192.png'
const url = src ?? fallback


return (
<img
src={url}
alt={alt}
height={h}
style={{ height: h, width: 'auto', imageRendering: 'crisp-edges' }}
decoding="async"
loading="eager"
/>
)
}