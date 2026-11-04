import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bug, ChevronRight, MessagesSquare, Send } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import { ClientPageHeader, ClientRow } from '@/features/client-app/ClientPageHeader'
import { supportApi, type Ticket } from '@/features/support/api'
import { categoryLabel } from '@/features/support/labels'
import { NewTicketDialog } from '@/features/support/NewTicketDialog'
import { TicketStatusPill } from '@/features/support/pills'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

const ticketsKey = ['client', 'support', 'tickets'] as const

/**
 * F74 Help (D67): each action has an obvious owner. "Contact agency" opens the General conversation with the
 * agency; "Report issue" goes to Unfoldd support.
 */
export function ClientHelpPage() {
  const s = useClientSession()
  const qc = useQueryClient()
  const [reporting, setReporting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const tickets = useQuery({ queryKey: ticketsKey, queryFn: () => supportApi.list('pageSize=25') })

  return (
    <>
      <ClientPageHeader title="Help" back={{ to: '/c/more', label: 'More' }} />
      <div className="flex flex-col gap-6">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          <li>
            <Link to="/c/conversations" className="block hover:bg-[#f6f5f6]">
              <ClientRow
                icon={<MessagesSquare size={19} />}
                title={`Contact ${s.agency.name}`}
                detail="Questions about your content, plans or brand"
                end={<ChevronRight size={18} className="shrink-0 text-text-4" />}
              />
            </Link>
          </li>
          <li>
            <button type="button" onClick={() => setReporting(true)} className="block w-full text-left hover:bg-[#f6f5f6]">
              <ClientRow icon={<Bug size={19} />} title="Report a problem" detail="Something in the app isn’t working: tell the Unfoldd team" end={<ChevronRight size={18} className="shrink-0 text-text-4" />} />
            </button>
          </li>
        </ul>

        <Card title="Your reports">
          {tickets.isPending ? (
            <div className="h-20" />
          ) : tickets.isError ? (
            <EmptyState title="Couldn’t load your reports">{errorMessage(tickets.error)}</EmptyState>
          ) : tickets.data.items.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-text-3">You haven’t reported anything.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.data.items.map((t) => (
                <li key={t._id}>
                  <button type="button" onClick={() => setOpen(t._id)} className="block w-full text-left hover:bg-[#f6f5f6]">
                    <ClientRow title={t.subject} detail={`${categoryLabel[t.category]} · ${timeAgo(t.lastMessageAt)}`} end={<TicketStatusPill status={t.status} />} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {reporting && (
        <NewTicketDialog
          fromUrl={location.href}
          onClose={() => setReporting(false)}
          onCreated={() => {
            setReporting(false)
            toast('Thanks, the Unfoldd team has it')
            void qc.invalidateQueries({ queryKey: ticketsKey })
          }}
        />
      )}
      {open && <TicketDialog id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const ticket = useQuery({ queryKey: [...ticketsKey, id], queryFn: () => supportApi.get(id) })
  const reply = useMutation({
    mutationFn: () => supportApi.reply(id, body.trim()),
    onSuccess: (data) => {
      setBody('')
      qc.setQueryData([...ticketsKey, id], data)
      void qc.invalidateQueries({ queryKey: ticketsKey })
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const t: Ticket | undefined = ticket.data?.ticket

  return (
    <Dialog title={t?.subject ?? 'Report'} description={t && <TicketStatusPill status={t.status} />} onClose={onClose}>
      {!t ? (
        <div className="h-32" />
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
            {t.messages.map((m, i) => (
              <li key={i} className={m.from === 'support' ? 'rounded-xl bg-green-soft/60 px-3 py-2.5' : 'rounded-xl bg-surface-input px-3 py-2.5'}>
                <div className="text-xs text-text-3">
                  <span className="font-medium text-text-2">{m.from === 'support' ? 'Unfoldd support' : m.author.name}</span> · {formatDateTime(m.at)}
                </div>
                <p className="mt-1 text-[14px] whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>
          {t.status !== 'resolved' && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (body.trim()) reply.mutate()
              }}
            >
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a reply" maxLength={10_000} aria-label="Reply" />
              <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()} className="self-end">
                <Send size={14} /> Send
              </Button>
            </form>
          )}
        </div>
      )}
    </Dialog>
  )
}
