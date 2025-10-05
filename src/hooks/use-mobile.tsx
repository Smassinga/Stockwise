import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const matches = 'matches' in e ? e.matches : (e as MediaQueryList).matches
      setIsMobile(matches)
    }
    // initial
    onChange(mql)
    // subscribe
    if ('addEventListener' in mql) mql.addEventListener('change', onChange as any)
    else (mql as any).addListener?.(onChange)
    return () => {
      if ('removeEventListener' in mql) mql.removeEventListener('change', onChange as any)
      else (mql as any).removeListener?.(onChange)
    }
  }, [])

  return isMobile
}
