import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Info, Send } from 'lucide-react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Field, Textarea } from '@/components/ui/Field'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { clientRequestKey, clientRequestsApi } from '@/features/client-app/requests/api'
import { RequestStatusPill } from '@/features/client-app/requests/pills'
import { RequestUploads } from '@/features/client-app/requests/RequestUploads'
import { useClientSpace } from '@/features/client-app/space'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'

/** F54–F56: one request: why it's needed, the files, an optional reply, and Submit. Viewers only look. */
export function ClientRequestDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const space = useClientSpace()
  const query = useQuery({ queryKey: clientRequestKey(id), queryFn: () => clientRequestsApi.get(id) })
  const [reply, setReply] = useState('')
  const [sent, setSent] = useState(false)
  const idem = useIdempotencyKey()
  const back = { to: '/c/requests', label: 'Needed from you' }

  const submit = useMutation({
    mutationFn: () => clientRequestsApi.submit(id, reply.trim(), idem.key),
    onSuccess: (data) => {
      qc.setQueryData(clientRequestKey(id), data)
      void qc.invalidateQueries({ queryKey: ['client', 'requests', 'list'] })
      void qc.invalidateQueries({ queryKey: ['client', 'home'] })
      setSent(true)
      setReply('')
    },
  })

  if (query.isPending) return <ClientPageHeader title="Request" back={back} />
  if (query.isError) {
    return (
      <>
        <ClientPageHeader title="Request" back={back} />
        <EmptyState title="Couldn’t open this request">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const r = query.data.request
  const canUpload = !!space.data?.can.upload
  const errors = fieldErrors(submit.error)

  return (
    <>
      <ClientPageHeader back={back} title={r.title} description={r.due ? `Due ${formatDate(r.due)}` : undefined} action={<RequestStatusPill request={r} />} />

      {sent && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl bg-green-soft px-4 py-3.5 text-green-ink">
          <CheckCircle2 size={20} className="mt-px shrink-0" />
          <div>
            <p className="text-[14px] font-semibold">Received. Thank you.</p>
            <p className="text-[13px]">Your agency has been told.</p>
          </div>
        </div>
      )}

      {r.returnNote && r.status === 'open' && (
        <p className="mb-5 flex gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-amber-ink">
          <Info size={17} className="mt-px shrink-0" />
          <span>
            <strong className="font-semibold">Your agency needs something else:</strong> {r.returnNote}
          </span>
        </p>
      )}

      <div className="flex flex-col gap-6">
        {(r.why || r.description) && (
          <section className="rounded-2xl border border-border bg-white p-4">
            {r.why && (
              <>
                <h2 className="text-xs font-medium text-text-3">Why it’s needed</h2>
                <p className="mt-1 text-[14px] whitespace-pre-line">{r.why}</p>
              </>
            )}
            {r.description && (
              <>
                <h2 className={r.why ? 'mt-4 text-xs font-medium text-text-3' : 'text-xs font-medium text-text-3'}>Details</h2>
                <p className="mt-1 text-[14px] whitespace-pre-line">{r.description}</p>
              </>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Files</h2>
          <RequestUploads request={r} canUpload={canUpload} />
        </section>

        {r.status !== 'open' && r.response && (
          <section className="rounded-2xl border border-border bg-white p-4">
            <h2 className="text-xs font-medium text-text-3">Your reply{r.submittedAt ? ` · ${timeAgo(r.submittedAt)}` : ''}</h2>
            <p className="mt-1 text-[14px] whitespace-pre-line">{r.response}</p>
          </section>
        )}

        {r.status === 'open' &&
          (canUpload ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                submit.mutate()
              }}
            >
              <Field label="Reply (optional)" htmlFor="req-reply" error={errors.response} hint="Anything your agency should know about what you’re sending.">
                <Textarea id="req-reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
              </Field>
              {submit.isError && !errors.response && <p className="text-[13px] text-negative">{errorMessage(submit.error)}</p>}
              <Button type="submit" variant="primary" loading={submit.isPending} disabled={!r.files.length && !reply.trim()} className="w-full">
                <Send size={15} /> Submit
              </Button>
            </form>
          ) : (
            <p className="text-[13px] text-text-3">Someone with upload access sends this. You can follow along here.</p>
          ))}
      </div>
    </>
  )
}
