import approvedLogo from '../../assets/brand/stockwise-logo.png'

type Props = {
  src?: string | null
  h?: number
  alt?: string
  variant?: 'auto' | 'light' | 'dark'
}

export default function Logo({ src, h = 44, alt = 'StockWise' }: Props) {
  const resolvedSrc = src || approvedLogo

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      height={h}
      style={{ height: h, width: 'auto' }}
      decoding="async"
      loading="eager"
    />
  )
}
