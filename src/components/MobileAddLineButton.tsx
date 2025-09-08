// src/components/MobileAddLineButton.tsx
import { useRef } from 'react'
import { Button } from './ui/button'

type Props = {
  label?: string
  onAdd: () => void
  className?: string
}

/**
 * Mobile-safe “Add line” button (iOS/Android).
 * - Uses pointer events (reliable in Sheets/Drawers)
 * - Debounces double-fire (pointerup + click)
 * - type="button" prevents accidental form submit
 */
export default function MobileAddLineButton({ label = '+ Add line', onAdd, className }: Props) {
  const lockRef = useRef(false)

  const fireOnce = () => {
    if (lockRef.current) return
    lockRef.current = true
    try { onAdd() } finally { setTimeout(() => (lockRef.current = false), 200) }
  }

  return (
    <Button
      type="button"
      onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); fireOnce() }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); fireOnce() }}
      className={['rounded-full px-4 py-3 sm:rounded-md sm:px-3 sm:py-2', className ?? ''].join(' ')}
      style={{ touchAction: 'manipulation' }}
    >
      {label}
    </Button>
  )
}
