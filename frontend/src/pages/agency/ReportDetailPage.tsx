import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { clientsApi } from '@/features/clients/api'
import { REPORT_SECTIONS, reportKey, reportsApi, type Report, type ReportSection } from '@/features/reports/api'
import { sectionLabel } from '@/features/reports/labels'
import { ReportStatusPill } from '@/features/reports/pills'
import { ReportView } from '@/features/reports/ReportView'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/** P127–P129: a report's frozen snapshot. Drafts can be edited, refreshed, shared or deleted; shared ones are locked. */
export function ReportDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({ queryKey: reportKey(id), queryFn: () => reportsApi.get(id) })
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'share' | 'delete' | null>(null)
  const client = useQuery({
    queryKey: ['agency', 'clients', 'detail', query.data?.report.client ?? ''],
    queryFn: () => clientsApi.get(query.data!.report.client),
    enabled: !!query.data,
  })

  const refresh = useMutation({
    mutationFn: () => reportsApi.refresh(id),
    onSuccess: (data) => {
      qc.setQueryData(reportKey(id), data)
      toast('Numbers refreshed')
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const back = { to: '/app/reports', label: 'Reports' }
  if (query.isPending) return <PageHeader title="Report" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Report" back={back} />
        <EmptyState title="Couldn’t open this report">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const r = query.data.report
  const draft = r.status === 'draft'
  const done = () => void qc.invalidateQueries({ queryKey: ['agency', 'reports'] })

  return (
    <>
      <PageHeader
        back={back}
        title={r.title}
        meta={<ReportStatusPill status={r.status} />}
        description={
          <>
            {client.data?.client.brandName ?? ''} · {formatDate(r.period.from)} – {formatDate(r.period.to)} ·{' '}
            {draft ? `numbers from ${timeAgo(r.generatedAt)}` : `shared ${formatDateTime(r.sharedAt)}${r.sharedBy ? ` by ${r.sharedBy.name}` : ''}`}
          </>
        }
        actions={
          draft && (
            <>
              <Button onClick={() => setConfirm('delete')} aria-label="Delete draft">
                <Trash2 size={15} />
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit
              </Button>
              <Button onClick={() => refresh.mutate()} loading={refresh.isPending}>
                <RefreshCw size={15} /> Refresh numbers
              </Button>
              <Button variant="primary" onClick={() => setConfirm('share')}>
                <Send size={15} /> Share with client
              </Button>
            </>
          )
        }
      />
      {draft && <p className="mb-5 rounded-lg border border-border-strong bg-surface px-4 py-3 text-[13px] text-text-2">Draft: only your team can see it. This is exactly what the client will see once you share it.</p>}
      <ReportView report={r} />

      {editing && (
        <EditReportDialog
          report={r}
          onClose={() => setEditing(false)}
          onSaved={(data) => {
            qc.setQueryData(reportKey(id), data)
            done()
            setEditing(false)
          }}
        />
      )}
      {confirm === 'share' && (
        <ConfirmDialog
          title="Share this report?"
          confirm="Share with client"
          action={() => reportsApi.share(id)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            toast('Shared with the client')
            void qc.invalidateQueries({ queryKey: reportKey(id) })
            done()
          }}
        >
          <p>The client sees it under Analytics → Reports and is notified. The numbers freeze: a shared report never changes.</p>
        </ConfirmDialog>
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Delete this draft?"
          confirm="Delete draft"
          variant="danger"
          action={() => reportsApi.remove(id)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            toast('Draft deleted')
            done()
            navigate('/app/reports', { replace: true })
          }}
        >
          <p>The client never saw it.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function EditReportDialog({ report: r, onClose, onSaved }: { report: Report; onClose: () => void; onSaved: (data: { report: Report }) => void }) {
  const [title, setTitle] = useState(r.title)
  const [notes, setNotes] = useState(r.notes)
  const [sections, setSections] = useState<ReportSection[]>(r.sections)
  const save = useMutation({ mutationFn: () => reportsApi.update(r._id, { title: title.trim(), notes, sections }), onSuccess: onSaved })
  const errors = fieldErrors(save.error)
  return (
    <Dialog
      title="Edit report"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!title.trim() || sections.length === 0} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="er-title" error={errors.title}>
          <Input id="er-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-text-2">Sections</legend>
          {REPORT_SECTIONS.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] hover:bg-surface-input">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={sections.includes(s)}
                onChange={(e) => setSections((x) => (e.target.checked ? REPORT_SECTIONS.filter((y) => y === s || x.includes(y)) : x.filter((y) => y !== s)))}
              />
              {sectionLabel[s].label}
            </label>
          ))}
        </fieldset>
        <Field label="Notes and insights" htmlFor="er-notes" error={errors.notes}>
          <Textarea id="er-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} className="min-h-32" />
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  )
}
