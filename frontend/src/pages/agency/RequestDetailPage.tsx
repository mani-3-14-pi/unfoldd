import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Download, FileText, Pencil, RotateCcw, Send } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Details } from '@/components/ui/Details'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { priorityLabel } from '@/features/content/labels'
import { clientPickerQuery } from '@/features/planning/queries'
import { requestKey, requestsApi, type RequestAction, type RequestFile } from '@/features/requests/api'
import { fileCategoryLabel, requestSourceLabel } from '@/features/requests/labels'
import { RequestStatusPill } from '@/features/requests/pills'
import { RequestFormDialog } from '@/features/requests/RequestFormDialog'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/**
 * P92–P93: one request, what the client sent back, and the agency's next step: complete it, ask for something
 * else (back to open, with a note), or cancel. Tasks waiting on it unblock at either end state (D38).
 */
export function RequestDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: requestKey(id), queryFn: () => requestsApi.get(id) })
  const clients = useQuery(clientPickerQuery)
  const [dialog, setDialog] = useState<'edit' | 'reopen' | 'cancel' | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'requests'] })

  const act = useMutation({
    mutationFn: (action: RequestAction) => requestsApi.action(id, action),
    onSuccess: ({ request }) => {
      toast(request.status === 'open' ? 'Sent to the client' : request.status === 'completed' ? 'Marked done' : 'Updated')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const back = { to: '/app/requests', label: 'Requests' }
  if (query.isPending) return <PageHeader title="Request" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Request" back={back} />
        <EmptyState title="Couldn’t open this request">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const r = query.data.request
  const client = clients.data?.items.find((c) => c._id === r.client)
  const editable = ['draft', 'open'].includes(r.status)

  return (
    <>
      <PageHeader
        back={back}
        title={r.title}
        meta={<RequestStatusPill status={r.status} overdue={r.overdue} />}
        description={
          <>
            {client && (
              <Link to={`/app/clients/${client._id}`} className="font-medium text-text-2 hover:underline">
                {client.brandName}
              </Link>
            )}
            {r.due && ` · due ${formatDate(r.due)}`}
            {requestSourceLabel[r.source] && ` · ${requestSourceLabel[r.source]}`}
          </>
        }
        actions={
          <>
            {editable && (
              <Button onClick={() => setDialog('edit')}>
                <Pencil size={15} /> Edit
              </Button>
            )}
            {['draft', 'open', 'submitted'].includes(r.status) && (
              <Button onClick={() => setDialog('cancel')}>
                <Ban size={15} /> Cancel request
              </Button>
            )}
            {r.status === 'draft' && (
              <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('publish')}>
                <Send size={15} /> Send to client
              </Button>
            )}
            {r.status === 'submitted' && (
              <>
                <Button onClick={() => setDialog('reopen')}>
                  <RotateCcw size={15} /> Need something else
                </Button>
                <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('complete')}>
                  <CheckCircle2 size={15} /> Mark done
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="From the client" description={r.submittedAt ? `Submitted by ${r.submittedBy?.name ?? 'the client'} ${timeAgo(r.submittedAt)}` : undefined}>
            <div className="flex flex-col gap-4 px-5 py-4">
              {r.response && <p className="rounded-lg bg-surface-input px-3 py-2 text-[13px] whitespace-pre-line">{r.response}</p>}
              {r.files.length === 0 ? (
                <p className="text-[13px] text-text-3">{r.status === 'draft' ? 'Not sent to the client yet.' : 'Nothing uploaded yet.'}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {r.files.map((f) => (
                    <FileRow key={f.file} file={f} />
                  ))}
                </ul>
              )}
              {r.returnNote && r.status === 'open' && (
                <p className="rounded-lg border border-amber-soft bg-[#fdf8f1] px-3 py-2 text-[13px] text-amber-ink">You asked for something else: “{r.returnNote}”</p>
              )}
            </div>
          </Card>
          <Card title="What you asked for">
            <Details
              rows={[
                { label: 'Details', value: r.description, wide: true },
                { label: 'Why', value: r.why, wide: true },
              ]}
            />
          </Card>
        </div>
        <Card title="Details">
          <Details
            className="sm:grid-cols-1"
            rows={[
              { label: 'Due', value: r.due ? `${formatDate(r.due)}${r.overdue ? ' (overdue)' : ''}` : 'No due date' },
              { label: 'Priority', value: priorityLabel[r.priority] },
              { label: 'Uploads go to', value: fileCategoryLabel[r.uploadCategory] },
              { label: 'Linked content', value: r.content && <Link to={`/app/content/${r.content}`} className="hover:underline">Open content</Link> },
              { label: 'Linked campaign', value: r.campaign && <Link to={`/app/campaigns/${r.campaign}`} className="hover:underline">Open campaign</Link> },
              { label: 'Client opened it', value: r.viewedAt ? formatDateTime(r.viewedAt) : r.status === 'draft' ? '' : 'Not yet' },
              { label: 'Created', value: formatDateTime(r.createdAt) },
            ]}
          />
        </Card>
      </div>

      {dialog === 'edit' && (
        <RequestFormDialog
          request={r}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            toast('Request saved')
            refresh()
          }}
          onReload={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
      {dialog === 'reopen' && <ReopenDialog id={r._id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'cancel' && (
        <ConfirmDialog
          title={`Cancel “${r.title}”?`}
          confirm="Cancel request"
          variant="danger"
          action={() => requestsApi.action(r._id, 'cancel')}
          onClose={() => setDialog(null)}
          onDone={() => {
            toast('Request cancelled')
            refresh()
          }}
        >
          <p>{r.status === 'draft' ? 'The draft is closed.' : 'The client is told it’s no longer needed.'} Tasks waiting on it are released.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function FileRow({ file: f }: { file: RequestFile }) {
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/files/${f.file}/download`),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border-strong bg-white px-3 py-2">
      <FileText size={17} className="shrink-0 text-text-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{f.info?.name ?? 'File'}</span>
        <span className="block text-xs text-text-4">
          {f.info ? kb(f.info.size) : ''}
          {f.addedBy && ` · ${f.addedBy.name}`} · {timeAgo(f.addedAt)}
          {!f.submittedAt && ' · not submitted yet'}
        </span>
      </span>
      <Button size="sm" variant="ghost" aria-label={`Download ${f.info?.name ?? 'file'}`} loading={download.isPending} disabled={f.info?.status !== 'ready'} onClick={() => download.mutate()}>
        <Download size={14} />
      </Button>
    </li>
  )
}

/** "Need something else" (§6.6): back to the client with a note. They can only add files. */
function ReopenDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => requestsApi.action(id, 'reopen', note.trim()),
    onSuccess: () => {
      toast('Sent back to the client')
      onDone()
      onClose()
    },
  })
  return (
    <Dialog
      title="Need something else"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={m.isPending} disabled={!note.trim()} onClick={() => m.mutate()}>
            Send back
          </Button>
        </>
      }
    >
      <Field label="What else do you need?" htmlFor="reopen-note" hint="The client sees this. What they already sent stays.">
        <Textarea id="reopen-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
      {m.isError && <p className="mt-2 text-[13px] text-negative">{errorMessage(m.error)}</p>}
    </Dialog>
  )
}
