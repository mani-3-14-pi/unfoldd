import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/Field'
import { clientPickerQuery } from './queries'

/** A client dropdown: a list filter (with "All clients") or a required form field. */
export function ClientSelect({
  id,
  value,
  onChange,
  allLabel,
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (clientId: string) => void
  /** Shown as the empty choice, e.g. "All clients" or "Choose a client…". */
  allLabel: string
  disabled?: boolean
  className?: string
}) {
  const clients = useQuery(clientPickerQuery)
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || clients.isPending} className={className} aria-label={id ? undefined : 'Client'}>
      <option value="">{allLabel}</option>
      {clients.data?.items.map((c) => (
        <option key={c._id} value={c._id}>
          {c.brandName}
        </option>
      ))}
    </Select>
  )
}
