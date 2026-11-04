import type { Tone } from '@/components/ui/Pill'
import type { MeetingPlatform, MeetingStatus } from './api'

export const meetingStatusLabel: Record<MeetingStatus, string> = { scheduled: 'Scheduled', completed: 'Done', cancelled: 'Cancelled' }
export const meetingStatusTone: Record<MeetingStatus, Tone> = { scheduled: 'blue', completed: 'green', cancelled: 'gray' }

export const meetingPlatformLabel: Record<MeetingPlatform, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  phone: 'Phone',
  in_person: 'In person',
  other: 'Other',
}
