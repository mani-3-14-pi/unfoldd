import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, RefreshCw, Unplug } from 'lucide-react'
import { CellText } from '@/components/list/DataTable'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { ClientDetail } from '@/features/clients/api'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { appOf, connectionsKey, integrationsApi, type Connection } from './api'
import { ConnectionStatusPill } from './pills'

/**
 * A client's connected social accounts (P157, D66). Scheduled posts go out through them automatically and their
 * numbers feed Analytics. Without one, publishing stays manual: the publisher is reminded and marks it published.
 */
export function ClientIntegrations({ client }: { client: ClientDetail }) {
  const qc = useQueryClient()
  const platforms = useQuery({ queryKey: ['agency', 'integrations', 'platforms'], queryFn: integrationsApi.platforms, staleTime: 5 * 60_000 })
  const connections = useQuery({ queryKey: connectionsKey(client._id), queryFn: () => integrationsApi.connections(client._id) })
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: connectionsKey(client._id) })
  const label = (key: string) => platforms.data?.items.find((p) => p.key === key)?.label ?? key

  const connect = useMutation({
    mutationFn: (platform: string) => integrationsApi.authorize(appOf(platform), client._id),
    // The platform sends the browser back to /app/integrations/callback when the person is done.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const check = useMutation({
    mutationFn: (c: Connection) => integrationsApi.check(c._id),
    onSuccess: (r, c) => {
      toast(r.ok ? `${c.name} is working` : `${c.name}: ${r.error ?? 'the check failed'}`, r.ok ? 'success' : 'error')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const built = (platforms.data?.items ?? []).filter((p) => p.status === 'built')
  const later = (platforms.data?.items ?? []).filter((p) => p.status !== 'built')

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card title="Connected accounts" description="Scheduled posts publish through these automatically, and their numbers show in Analytics.">
        {connections.isPending ? (
          <div className="h-24" />
        ) : connections.isError ? (
          <EmptyState title="Couldn’t load connections">{errorMessage(connections.error)}</EmptyState>
        ) : connections.data.items.length === 0 ? (
          <EmptyState title="No accounts connected">Publishing is manual until you connect one: at the scheduled time the publisher is reminded to post it.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {connections.data.items.map((c) => (
              <li key={c._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <CellText primary={`${label(c.platform)} · ${c.name}`} secondary={[c.handle && `@${c.handle.replace(/^@/, '')}`, c.lastCheckedAt && `checked ${timeAgo(c.lastCheckedAt)}`].filter(Boolean).join(' · ') || undefined} />
                  {c.lastError && c.status !== 'active' && <p className="mt-1 text-xs text-negative">{c.lastError}</p>}
                </div>
                <ConnectionStatusPill status={c.status} />
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" loading={check.isPending && check.variables?._id === c._id} onClick={() => check.mutate(c)}>
                    <RefreshCw size={13} /> Check
                  </Button>
                  {client.canManage && (c.status === 'expired' || c.status === 'error') && (
                    <Button size="sm" variant="ghost" onClick={() => connect.mutate(c.platform)}>
                      <Link2 size={13} /> Reconnect
                    </Button>
                  )}
                  {client.canManage && (
                    <Button size="sm" variant="ghost" aria-label={`Disconnect ${c.name}`} onClick={() => setDisconnecting(c)}>
                      <Unplug size={13} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Connect an account" description={client.canManage ? 'You’ll sign in on the platform and choose which accounts to connect.' : 'A manager or admin connects accounts.'}>
        {platforms.isPending ? (
          <div className="h-24" />
        ) : (
          <ul className="divide-y divide-border">
            {built.map((p) => (
              <li key={p.key} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{p.label}</div>
                  <div className="text-xs text-text-3">{p.notes}</div>
                </div>
                {p.configured ? (
                  client.canManage && (
                    <Button size="sm" loading={connect.isPending && connect.variables === p.key} onClick={() => connect.mutate(p.key)}>
                      <Link2 size={13} /> Connect
                    </Button>
                  )
                ) : (
                  <span className="shrink-0 text-xs text-text-4">Not set up on this server yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {later.length > 0 && (
          <details className="border-t border-border px-5 py-3 text-xs text-text-3">
            <summary className="cursor-pointer select-none">Platforms that could be added later</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {later.map((p) => (
                <li key={p.key}>
                  <span className="font-medium text-text-2">{p.label}</span> · {p.notes}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {disconnecting && (
        <ConfirmDialog
          title={`Disconnect ${disconnecting.name}?`}
          confirm="Disconnect"
          variant="danger"
          action={() => integrationsApi.disconnect(disconnecting._id)}
          onClose={() => setDisconnecting(null)}
          onDone={() => {
            toast(`${disconnecting.name} disconnected`)
            refresh()
          }}
        >
          <p>Posts scheduled through it won’t go out automatically. Past posts and their numbers stay. You can connect it again later.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
