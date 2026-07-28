import { useReducedMotion } from 'framer-motion'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react'
import { cn } from '../../lib/utils'

export interface GlareHoverProps extends ComponentProps<'div'> {
  color?: `#${string}`
  opacity?: number
  angle?: number
  size?: number
  duration?: number
  playOnce?: boolean
}

function hexToRgba(color: `#${string}`, opacity: number) {
  const value = color.slice(1)
  const full = value.length === 3
    ? value.split('').map((character) => `${character}${character}`).join('')
    : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return color
  const channel = (start: number) => Number.parseInt(full.slice(start, start + 2), 16)
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${opacity})`
}

export function GlareHover({
  children,
  className,
  color = '#ffffff',
  opacity = 0.12,
  angle = -40,
  size = 260,
  duration = 800,
  playOnce = false,
  onPointerEnter,
  onFocusCapture,
  style,
  ...props
}: GlareHoverProps) {
  const reduceMotion = useReducedMotion()
  const [played, setPlayed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const glareColor = useMemo(() => hexToRgba(color, opacity), [color, opacity])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const cssVars = {
    '--glare-angle': `${angle}deg`,
    '--glare-duration': `${duration}ms`,
    '--glare-size': `${size}%`,
    '--glare-color': glareColor,
    ...style,
  } as CSSProperties

  const schedulePlayed = () => {
    if (!playOnce || reduceMotion || played || timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      setPlayed(true)
      timerRef.current = null
    }, duration)
  }

  return (
    <div
      {...props}
      className={cn(
        'glare-hover relative isolate overflow-hidden',
        (reduceMotion || played) && 'glare-hover--static',
        className,
      )}
      style={cssVars}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        schedulePlayed()
      }}
      onFocusCapture={(event) => {
        onFocusCapture?.(event)
        schedulePlayed()
      }}
    >
      {children}
    </div>
  )
}
