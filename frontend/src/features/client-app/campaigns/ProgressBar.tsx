import type { CampaignProgress } from './api'

/** Published share of the campaign's content (P36: derived from content states, never stored). */
export function ProgressBar({ progress: p }: { progress: CampaignProgress }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-input" role="img" aria-label={`${p.percent}% published`}>
        <span className="block h-full rounded-full bg-green-dot" style={{ width: `${p.percent}%` }} />
      </span>
      <span className="shrink-0 text-xs text-text-3">
        {p.published} of {p.total} live
      </span>
    </span>
  )
}
