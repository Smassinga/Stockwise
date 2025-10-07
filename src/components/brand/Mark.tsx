type Props = {
  /** Square size in px */
  size?: number
  /** 'light' | 'dark' | 'auto' (auto follows html.dark) */
  variant?: 'light' | 'dark' | 'auto'
  /** Accessible label */
  title?: string
}

export default function Mark({ size = 44, variant = 'auto', title = 'StockWise' }: Props) {
  const isDark =
    variant === 'dark' ||
    (variant === 'auto' &&
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'))

  const bg = isDark ? '#0B1220' : '#FFFFFF'
  const stroke = isDark ? '#FFFFFF' : '#0B1220'
  const accent = isDark ? '#4DA3FF' : '#1565FF'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label={title}
      style={{ display: 'block' }}
    >
      <title>{title}</title>
      {/* Circle background */}
      <circle cx="128" cy="128" r="116" fill={bg} stroke={isDark ? '#1f2637' : '#E6E8F0'} strokeWidth="12"/>
      {/* Main path */}
      <path d="M62 100 C62 72 100 58 128 64 C156 70 170 90 164 110 C158 128 138 138 120 146 C98 156 86 168 86 186 C86 206 112 212 132 208 C150 206 164 198 176 186" fill="none" stroke={stroke} strokeWidth="14" strokeLinecap="round"/>
      {/* Tick and bar */}
      <path d="M110 178 L136 198 L206 132" fill="none" stroke={accent} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M170 162 L214 162" fill="none" stroke={accent} strokeWidth="14" strokeLinecap="round"/>
    </svg>
  )
}
