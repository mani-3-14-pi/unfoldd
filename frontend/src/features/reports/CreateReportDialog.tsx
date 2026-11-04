import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { defaultPeriod } from '@/features/analytics/labels'
import { PeriodPicker } from '@/features/analytics/PeriodPicker'
import { clientsApi } from '@/features/clients/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { REPORT_SECTIONS, reportsApi, type Report, type ReportSection } from './api'
import { sectionLabel } from './labels'

/** P126: a new report starts as a draft with a fresh snapshot. Nothing reaches the client until it's shared (D53). */
export function CreateReportDialog({ clientId, onClose, onCreated }: { clientId?: string; onClose: () => void; onCreated: (r: Report) => void }) {
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const [client, setClient] = useState(clientId ?? '')
  const [period, setPeriod] = useState(defaultPeriod)
  const [title, setTitle] = useState('')
  const [sections, setSections] = useState<ReportSection[]>([...REPORT_SECTIONS])
  const [notes, setNotes] = useState('')
  const idem = useIdempotencyKey()

  const create = useMutation({
    mutationFn: () => reportsApi.create({ client, ...period, sections, notes, ...(title.trim() ? { title: title.trim() } : {}) }, idem.key),
    onSuccess: ({ report }) => onCreated(report),
  })
  const errors = fieldErrors(create.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      title="New report"
      description="A draft with the numbers as they are now. Review it, then share it with the client."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="report-form" loading={create.isPending} disabled={!client || sections.length === 0}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="report-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Client" htmlFor="rep-client" error={errors.client}>
          <Select id="rep-client" value={client} onChange={(e) => setClient(e.target.value)} autoFocus={!clientId}>
            <option value="">Choose a client…</option>
            {clients.data?.items.map((c) => (
              <option key={c._id} value={c._id}>
                {c.brandName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-2">Period</span>
          <PeriodPicker from={period.from} to={period.to} onChange={setPeriod} />
          {(errors.to || errors.from) && <p className="text-xs text-negative">{errors.to ?? errors.from}</p>}
        </div>
        <Field label="Title (optional)" htmlFor="rep-title" hint="Defaults to the brand and the period." error={errors.title}>
          <Input id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-text-2">Sections</legend>
          {REPORT_SECTIONS.map((s) => (
            <label key={s} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-input">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand"
                checked={sections.includes(s)}
                onChange={(e) => setSections((x) => (e.target.checked ? REPORT_SECTIONS.filter((y) => y === s || x.includes(y)) : x.filter((y) => y !== s)))}
              />
              <span className="text-[13px]">
                {sectionLabel[s].label} <span className="text-xs text-text-4">· {sectionLabel[s].hint}</span>
              </span>
            </label>
          ))}
          {errors.sections && <p className="text-xs text-negative">{errors.sections}</p>}
        </fieldset>
        <Field label="Notes and insights" htmlFor="rep-notes" hint="Shown in the Notes section. You can edit them before sharing.">
          <Textarea id="rep-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} />
        </Field>
        {create.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(create.error)}</p>}
      </form>
    </Dialog>
  )
}
