import Mark from './Mark'

type Props = {
  /** Tenant-provided logo URL (e.g., DB). If present, it is used as-is. */
  src?: string | null
  /** Height for raster tenant logos; SVG mark uses the same number as its size. */
  h?: number
  /** Accessible label */
  alt?: string
  /** 'auto' follows html.dark */
  variant?: 'auto' | 'light' | 'dark'
}

export default function Logo({ src, h = 44, alt = 'StockWise', variant = 'auto' }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        height={h}
        style={{ height: h, width: 'auto' }}
        decoding="async"
        loading="eager"
      />
    )
  }
  return <Mark size={h} variant={variant} title={alt} />
}
