import approvedMark from '../../assets/brand/stockwise-mark.png'

type Props = {
  size?: number
  variant?: 'light' | 'dark' | 'auto'
  title?: string
}

export default function Mark({ size = 44, title = 'StockWise' }: Props) {
  return (
    <img
      src={approvedMark}
      alt={title}
      width={size}
      height={size}
      style={{ display: 'block', height: size, width: size }}
      decoding="async"
      loading="eager"
    />
  )
}
