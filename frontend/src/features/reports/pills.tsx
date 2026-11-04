import { Pill } from '@/components/ui/Pill'

export function ReportStatusPill({ status }: { status: 'draft' | 'shared' }) {
  return <Pill tone={status === 'shared' ? 'green' : 'gray'}>{status === 'shared' ? 'Shared with client' : 'Draft'}</Pill>
}
