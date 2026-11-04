import { Pill } from '@/components/ui/Pill'
import type { MeetingStatus } from './api'
import { meetingStatusLabel, meetingStatusTone } from './labels'

export function MeetingStatusPill({ status }: { status: MeetingStatus }) {
  return <Pill tone={meetingStatusTone[status]}>{meetingStatusLabel[status]}</Pill>
}
