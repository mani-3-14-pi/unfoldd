import { PageHeader } from '@/components/PageHeader'
import { MeetingList } from '@/features/meetings/MeetingList'

/** P103: meetings across every client this person can see. */
export function MeetingsPage() {
  return (
    <>
      <PageHeader title="Meetings" description="Calls with clients, their summaries, decisions and action items." />
      <MeetingList />
    </>
  )
}
