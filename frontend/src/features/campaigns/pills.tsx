import { Pill } from '@/components/ui/Pill'
import type { CampaignProgress, CampaignStatus } from './api'
import { campaignStatusLabel, campaignStatusTone } from './labels'

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return <Pill tone={campaignStatusTone[status]}>{campaignStatusLabel[status]}</Pill>
}

/** P36: published out of all non-cancelled content, with approved as a lighter second bar. */
export function ProgressBar({ progress: p, compact }: { progress: CampaignProgress; compact?: boolean }) {
  const approved = p.total ? Math.round((p.approved / p.total) * 100) : 0
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-surface-input"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Published"
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-green-soft" style={{ width: `${approved}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-positive" style={{ width: `${p.percent}%` }} />
      </div>
      {!compact && (
        <span className="text-[11px] text-text-3">
          {p.total ? `${p.published} of ${p.total} published · ${p.approved} approved` : 'No content yet'}
        </span>
      )}
    </div>
  )
}
