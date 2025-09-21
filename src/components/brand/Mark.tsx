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

  const bg = isDark ? '#0F172A' : '#2F5DF5'
  const stroke = isDark ? '#2F5DF5' : '#FFFFFF'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      style={{ display: 'block' }}
    >
      <title>{title}</title>
      {/* rounded square tile */}
      <rect x="2" y="2" width="60" height="60" rx="10" fill={bg} />
      {/* monoline cube */}
      <g stroke={stroke} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M16 40 L48 40 L48 24 L16 24 Z" />
        <path d="M16 24 L32 16 L48 24" />
        <path d="M32 16 L32 40" />
      </g>
    </svg>
  )
}
