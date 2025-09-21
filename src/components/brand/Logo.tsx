// src/components/brand/Logo.tsx
import * as React from 'react'

type Props = {
  /** Tenant logo URL (from DB). If provided, this is used and we don't auto-swap. */
  src?: string | null
  /** Display height in px; width auto. */
  h?: number
  /** Accessible label */
  alt?: string
  /** Force a variant; 'auto' uses OS scheme. */
  variant?: 'auto' | 'light' | 'dark'
}

export default function Logo({
  src,
  h = 40,
  alt = 'StockWise',
  variant = 'auto',
}: Props) {
  const chooseByScheme = React.useCallback(() => {
    if (variant === 'light') return '/icon-192.png'
    if (variant === 'dark')  return '/icon-192-dark.png'
    // auto
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return '/icon-192-dark.png'
    }
    return '/icon-192.png'
  }, [variant])

  const [imgSrc, setImgSrc] = React.useState<string>(src ?? chooseByScheme())

  // Update on OS scheme change when in 'auto' and no tenant src
  React.useEffect(() => {
    if (src || variant !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setImgSrc(mq.matches ? '/icon-192-dark.png' : '/icon-192.png')
    update()
    if (mq.addEventListener) mq.addEventListener('change', update)
    else mq.addListener(update)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update)
      else mq.removeListener(update)
    }
  }, [src, variant])

  // If dark asset is missing, fall back to light one seamlessly
  const handleError = () => {
    if (!src && imgSrc !== '/icon-192.png') setImgSrc('/icon-192.png')
  }

  return (
    <img
      src={imgSrc}
      alt={alt}
      height={h}
      style={{ height: h, width: 'auto', imageRendering: 'crisp-edges' }}
      decoding="async"
      loading="eager"
      onError={handleError}
    />
  )
}
