// src/types/lucide-esm-icons.d.ts
import * as React from 'react'

type LucideProps = React.SVGProps<SVGSVGElement> & {
  color?: string
  size?: string | number
  strokeWidth?: string | number
  absoluteStrokeWidth?: boolean
}

declare module 'lucide-react/dist/esm/icons/*' {
  const Icon: React.ForwardRefExoticComponent<
    LucideProps & React.RefAttributes<SVGSVGElement>
  >
  export default Icon
}
