import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Lock, Pencil, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Details } from '@/components/ui/Details'
import { Textarea } from '@/components/ui/Field'
import { clientsApi } from '@/features/clients/api'
import { meetingKey, meetingsApi, type Meeting } from '@/features/meetings/api'
import { meetingPlatformLabel } from '@/features/meetings/labels'
import { MeetingFormDialog } from '@/features/meetings/MeetingFormDialog'
import { MeetingStatusPill } from '@/features/meetings/pills'
import { SummaryEditor } from '@/features/meetings/SummaryEditor'
import { useMeetingOptions } from '@/features/meetings/useMeetingOptions'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { formatInZone } from '@/lib/zonedTime'

/** P105–P109: one meeting: details, the internal transcript, and the summary to share. */
export function MeetingDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: meetingKey(id), queryFn: () => meetingsApi.get(id) })
  const clientId = query.data?.meeting.client ?? ''
  const client = useQuery({ queryKey: ['agency', 'clients', 'detail', clientId], queryFn: () => clientsApi.get(clientId), enabled: !!clientId })
  const options = useMeetingOptions(clientId)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | null>(null)

  const back = { to: '/app/meetings', label: 'Meetings' }
  if (query.isPending || (query.isSuccess && client.isPending)) return <PageHeader title="Meeting" back={back} />
  if (query.isError || client.isError) {
    return (
      <>
        <PageHeader title="Meeting" back={back} />
        <EmptyState title="Couldn’t open this meeting">{errorMessage(query.error ?? client.error)}</EmptyState>
      </>
    )
  }
  const m = query.data.meeting
  const c = client.data!.client
  const tz = c.timezone
  const writable = c.status !== 'archived'
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'meetings'] })
  const names = (ids: string[], list: { _id: string; name: string }[] | undefined) => ids.map((pid) => list?.find((u) => u._id === pid)?.name ?? '…').join(', ')
  const campaign = options.campaigns.data?.find((x) => x._id === m.campaign)
  const content = options.content.data?.filter((x) => m.content.includes(x._id)) ?? []

  return (
    <>
      <PageHeader
        back={back}
        title={m.title}
        meta={<MeetingStatusPill status={m.status} />}
        description={
          <>
            <Link to={`/app/clients/${c._id}`} className="font-medium text-text-2 hover:underline">
              {c.brandName}
            </Link>{' '}
            · {formatInZone(m.startAt, tz)}
          </>
        }
        actions={
          <>
            {m.joinUrl && m.status === 'scheduled' && (
              <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-hover">
                <ExternalLink size={15} /> Join
              </a>
            )}
            {writable && m.status === 'scheduled' && (
              <>
                <Button onClick={() => setEditing(true)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button onClick={() => setConfirm('cancel')}>
                  <XCircle size={15} /> Cancel
                </Button>
                <Button variant="primary" onClick={() => setConfirm('complete')}>
                  <CheckCircle2 size={15} /> Mark done
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {m.status !== 'cancelled' && <SummaryEditor key={`${m.summary.status}-${m.rev}`} meeting={m} people={options.agency.data ?? []} writable={writable} onChanged={refresh} />}
          <Transcript meeting={m} writable={writable && m.status !== 'cancelled'} onSaved={refresh} />
        </div>
        <Card title="Details">
          <Details
            className="sm:grid-cols-1"
            rows={[
              { label: 'When', value: `${formatInZone(m.startAt, tz)} – ${formatInZone(m.endAt, tz, { withViewer: false }).split(', ').at(-1)}` },
              { label: 'Where', value: [meetingPlatformLabel[m.platform], m.location].filter(Boolean).join(' · ') },
              { label: 'Join link', value: m.joinUrl && <a href={m.joinUrl} target="_blank" rel="noreferrer" className="break-all hover:underline">{m.joinUrl}</a> },
              { label: 'Your team', value: names(m.participants.agency, options.agency.data) },
              { label: 'From the client', value: names(m.participants.client, options.client.data) },
              { label: 'Agenda', value: m.agenda },
              { label: 'Campaign', value: campaign?.name },
              {
                label: 'Content',
                value: content.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {content.map((x) => (
                      <li key={x._id}>
                        <Link to={`/app/content/${x._id}`} className="hover:underline">
                          {x.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </Card>
      </div>

      {editing && (
        <MeetingFormDialog
          meeting={m}
          timezone={tz}
          onClose={() => setEditing(false)}
          onSaved={() => {
            toast('Meeting saved')
            setEditing(false)
            refresh()
          }}
          onReload={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'complete' ? 'Mark the meeting as done?' : `Cancel ${m.title}?`}
          confirm={confirm === 'complete' ? 'Mark done' : 'Cancel meeting'}
          variant={confirm === 'cancel' ? 'danger' : 'primary'}
          action={() => meetingsApi.action(m._id, confirm)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            toast(confirm === 'complete' ? 'Marked as done. Write the summary when you’re ready.' : 'Meeting cancelled. The client was told.')
            refresh()
          }}
        >
          <p>{confirm === 'complete' ? 'Then write and share the summary.' : 'The client’s people are told it’s cancelled.'}</p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** D23: the transcript is the agency's working material and is never shown to the client. */
function Transcript({ meeting: m, writable, onSaved }: { meeting: Meeting; writable: boolean; onSaved: () => void }) {
  const [text, setText] = useState(m.transcript)
  const save = useMutation({
    mutationFn: () => meetingsApi.transcript(m._id, text),
    onSuccess: () => {
      toast('Transcript saved')
      onSaved()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  return (
    <Card
      title="Transcript and notes"
      description={
        <span className="inline-flex items-center gap-1">
          <Lock size={11} /> Internal: never shared with the client.
        </span>
      }
      action={
        writable && (
          <Button size="sm" loading={save.isPending} disabled={text === m.transcript} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="px-5 py-4">
        <Textarea
          aria-label="Transcript"
          value={text}
          disabled={!writable}
          onChange={(e) => setText(e.target.value)}
          maxLength={500_000}
          placeholder="Paste the transcript or your notes."
          className="min-h-48"
        />
      </div>
    </Card>
  )
}
