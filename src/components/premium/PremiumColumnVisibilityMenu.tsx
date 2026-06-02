import type { ReactNode } from 'react'
import { Columns3 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { PremiumColumnVisibilityState, PremiumDataTableColumn } from './PremiumDataTable'

export function PremiumColumnVisibilityMenu<T>({
  columns,
  visibility,
  onVisibilityChange,
  label = 'Columns',
  menuLabel = 'Visible columns',
}: {
  columns: PremiumDataTableColumn<T>[]
  visibility: PremiumColumnVisibilityState
  onVisibilityChange: (visibility: PremiumColumnVisibilityState) => void
  label?: ReactNode
  menuLabel?: ReactNode
}) {
  const hideableColumns = columns.filter((column) => column.enableHiding !== false)

  if (!hideableColumns.length) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 className="h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={visibility[column.id] !== false}
            onCheckedChange={(checked) =>
              onVisibilityChange({
                ...visibility,
                [column.id]: Boolean(checked),
              })
            }
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
