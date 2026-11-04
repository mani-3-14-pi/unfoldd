import type { ReportSection } from './api'

export const sectionLabel: Record<ReportSection, { label: string; hint: string }> = {
  summary: { label: 'Summary', hint: 'Headline numbers for the period' },
  platforms: { label: 'Platforms', hint: 'Numbers per platform' },
  top_posts: { label: 'Top posts', hint: 'The best posts by engagements' },
  delivery: { label: 'Delivery', hint: 'Posts published, approvals, rounds of changes' },
  notes: { label: 'Notes', hint: 'Your commentary and insights' },
}
