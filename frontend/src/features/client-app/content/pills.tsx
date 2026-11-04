import { Clock } from 'lucide-react'
import { Pill } from '@/components/ui/Pill'
import type { ClientStatus } from './api'
import { bucketLabel, bucketTone } from './labels'

/** The client's status label, plus the neutral "Publishing delayed" badge when a publish failed (D65). */
export function ClientStatusPill({ status }: { status: ClientStatus }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status.bucket ? <Pill tone={bucketTone[status.bucket]}>{bucketLabel[status.bucket]}</Pill> : <Pill tone="gray">{status.label}</Pill>}
      {status.delayed && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gray-soft px-2.5 text-[11px] font-medium text-gray-ink">
          <Clock size={11} /> Publishing delayed
        </span>
      )}
    </span>
  )
}
