import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CircleAlert, Link2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { buttonClass } from '@/components/ui/buttonClass'
import { Card, EmptyState } from '@/components/ui/Card'
import { integrationsApi } from '@/features/integrations/api'
import { callbackErrorText } from '@/features/integrations/labels'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'

const key = (a: { platform: string; externalId: string }) => `${a.platform}:${a.externalId}`

/**
 * Where a platform sends the browser after sign-in (D66, step 3): lists the accounts it found so the person
 * picks which to connect, then goes back to the client's integrations.
 */
export function IntegrationsCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const state = params.get('state') ?? ''
  const error = params.get('error')
  const clientParam = params.get('client') ?? ''
  const found = useQuery({ queryKey: ['agency', 'integrations', 'pending', state], queryFn: () => integrationsApi.pending(state), enabled: !!state && !error, retry: false })
  // Every found account starts ticked; `null` until the person changes something.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const accounts = found.data?.accounts ?? []
  const selected = picked ?? new Set(accounts.map(key))
  const client = found.data?.client ?? clientParam
  const backTo = client ? `/app/clients/${client}/integrations` : '/app/clients'

  const connect = useMutation({
    mutationFn: () => integrationsApi.connect(state, accounts.filter((a) => selected.has(key(a))).map(({ platform, externalId }) => ({ platform, externalId }))),
    onSuccess: ({ connections }) => {
      toast(`${connections.length} account${connections.length === 1 ? '' : 's'} connected`)
      navigate(backTo, { replace: true })
    },
  })

  const back = (
    <Link to={backTo} className={buttonClass('secondary')}>
      Back to the client
    </Link>
  )

  if (error || !state) {
    return (
      <>
        <PageHeader title="Connect accounts" />
        <EmptyState title="Nothing was connected" action={back}>
          {callbackErrorText[error ?? ''] ?? `The platform answered: ${error ?? 'no details'}. Try again.`}
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Choose accounts to connect" description="These are the accounts your sign-in can publish to. Connect the ones that belong to this client." />
      {found.isPending ? (
        <div className="h-40" />
      ) : found.isError ? (
        <EmptyState title="This connection attempt expired" action={back}>
          {errorMessage(found.error)}
        </EmptyState>
      ) : accounts.length === 0 ? (
        <EmptyState title="No accounts found" action={back}>
          Your sign-in doesn’t manage any account we can publish to. On Instagram, it needs to be a business or creator account linked to a Facebook Page.
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <ul className="divide-y divide-border">
            {accounts.map((a) => (
              <li key={key(a)}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={selected.has(key(a))}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(key(a))
                      else next.delete(key(a))
                      setPicked(next)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{a.name}</span>
                    <span className="block text-xs text-text-3 capitalize">
                      {a.platform}
                      {a.handle ? ` · @${a.handle.replace(/^@/, '')}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {connect.isError && (
              <span className="mr-auto flex items-center gap-1.5 text-[13px] text-negative">
                <CircleAlert size={14} /> {errorMessage(connect.error)}
              </span>
            )}
            {back}
            <Button variant="primary" loading={connect.isPending} disabled={selected.size === 0} onClick={() => connect.mutate()}>
              <Link2 size={15} /> Connect {selected.size || ''}
            </Button>
          </div>
        </Card>
      )}
    </>
  )
}
