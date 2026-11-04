import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CircleStop, EllipsisVertical, Pencil, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Field'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import { bannersApi, bannersKey, type Banner } from '@/features/banners/api'
import { BannerFormDialog } from '@/features/banners/BannerFormDialog'
import { BannerStatePill } from '@/features/banners/pills'
import { clientsApi } from '@/features/clients/api'
import { useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { formatInZone } from '@/lib/zonedTime'

/**
 * D52 banner manager: what each client sees at the top of their Home (F12). Manual banners are drafted, published
 * and ended here; automatic ones (e.g. "Your plan is ready") come from events and can only be ended.
 */
export function BannersPage() {
  const qc = useQueryClient()
  const state = useListState()
  const client = state.get('client')
  const showEnded = state.get('ended') === 'true'
  const [editing, setEditing] = useState<Banner | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Banner | null>(null)

  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const query = useQuery({ queryKey: [...bannersKey, client], queryFn: () => bannersApi.list(client || undefined) })
  const refresh = () => void qc.invalidateQueries({ queryKey: bannersKey })
  const onError = (err: unknown) => {
    toast(errorMessage(err), 'error')
    refresh()
  }

  const act = useMutation({
    mutationFn: ({ call }: { call: () => Promise<unknown>; done: string }) => call(),
    onSuccess: (_, { done }) => {
      toast(done)
      refresh()
    },
    onError,
  })

  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)
  const items = (query.data?.items ?? []).filter((b) => showEnded || b.state !== 'ended')
  const groups = [...new Set(items.map((b) => b.client))].map((id) => ({ id, banners: items.filter((b) => b.client === id).sort((a, b) => a.order - b.order) }))

  /** Swaps a banner with its neighbour, then saves the whole client's order (top first). */
  const move = (banner: Banner, by: -1 | 1) => {
    const all = (query.data?.items ?? []).filter((b) => b.client === banner.client).sort((a, b) => a.order - b.order)
    const i = all.findIndex((b) => b._id === banner._id)
    const j = i + by
    if (j < 0 || j >= all.length) return
    ;[all[i], all[j]] = [all[j]!, all[i]!]
    act.mutate({ call: () => bannersApi.reorder(banner.client, all.map((b) => b._id)), done: 'Order saved' })
  }

  const menu = (b: Banner): MenuItem[] => [
    ...(b.source === 'manual' && b.state !== 'ended' ? [{ label: 'Edit', icon: Pencil, onSelect: () => setEditing(b) }] : []),
    ...(b.state === 'draft' ? [{ label: 'Publish', icon: Send, onSelect: () => act.mutate({ call: () => bannersApi.publish(b._id), done: 'Banner published' }) }] : []),
    ...(b.state === 'live' || b.state === 'scheduled' ? [{ label: 'End now', icon: CircleStop, onSelect: () => act.mutate({ call: () => bannersApi.end(b._id), done: 'Banner ended' }) }] : []),
    ...(b.source === 'manual' ? [{ label: 'Delete', icon: Trash2, tone: 'danger' as const, separated: true, onSelect: () => setDeleting(b) }] : []),
  ]

  return (
    <>
      <PageHeader
        title="Banners"
        description="The banner at the top of each client’s Home in the client app. Top of the list shows first."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New banner
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Client" value={client} onChange={(e) => state.update({ client: e.target.value })} className="w-52">
          <option value="">All clients</option>
          {clients.data?.items.map((c) => (
            <option key={c._id} value={c._id}>
              {c.brandName}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <input type="checkbox" className="size-4 accent-brand" checked={showEnded} onChange={(e) => state.update({ ended: e.target.checked })} />
          Show ended banners
        </label>
      </div>

      {query.isPending ? (
        <div className="h-48" />
      ) : query.isError ? (
        <EmptyState title="Couldn’t load banners">{errorMessage(query.error)}</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No banners"
          action={
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> New banner
            </Button>
          }
        >
          Announce a new plan, a launch or a meeting on the client’s Home. Some appear by themselves, like when you send a content plan.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <Card key={g.id} title={brand(g.id)?.brandName ?? 'Client'}>
              <ul className="divide-y divide-border">
                {g.banners.map((b, i) => {
                  const tz = brand(b.client)?.timezone ?? 'UTC'
                  return (
                    <li key={b._id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex flex-col">
                        <button type="button" aria-label="Move up" disabled={i === 0 || act.isPending} onClick={() => move(b, -1)} className="grid size-6 place-items-center rounded text-text-3 hover:bg-black/5 disabled:opacity-30">
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === g.banners.length - 1 || act.isPending}
                          onClick={() => move(b, 1)}
                          className="grid size-6 place-items-center rounded text-text-3 hover:bg-black/5 disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                      <div className="grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-input text-[11px] text-text-4">
                        {b.imageUrl ? <img src={b.imageUrl} alt="" className="size-full object-cover" /> : 'No image'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-semibold">{b.headline}</span>
                          <BannerStatePill state={b.state} />
                          {b.source === 'auto' && (
                            <Pill tone="indigo" dot={false}>
                              <Sparkles size={11} /> Automatic
                            </Pill>
                          )}
                        </div>
                        {b.text && <p className="mt-0.5 line-clamp-1 text-xs text-text-2">{b.text}</p>}
                        <p className="mt-0.5 text-[11px] text-text-4">
                          {b.cta.link ? `Button “${b.cta.label || 'Open'}” → ${b.cta.link} · ` : ''}
                          {b.startAt ? `from ${formatInZone(b.startAt, tz, { withViewer: false })}` : 'from publishing'}
                          {b.endAt ? ` until ${formatInZone(b.endAt, tz, { withViewer: false })}` : ''}
                        </p>
                      </div>
                      {menu(b).length > 0 && (
                        <Menu label={`Actions for ${b.headline}`} heading={b.headline} items={menu(b)} className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5">
                          <EllipsisVertical size={17} />
                        </Menu>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <BannerFormDialog
          banner={editing === 'new' ? undefined : editing}
          clientId={editing === 'new' ? client || undefined : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast(editing === 'new' ? 'Banner created' : 'Banner saved')
            setEditing(null)
            refresh()
          }}
          onReload={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.headline}”?`}
          confirm="Delete"
          variant="danger"
          action={() => bannersApi.remove(deleting._id)}
          onClose={() => setDeleting(null)}
          onDone={() => {
            toast('Banner deleted')
            refresh()
          }}
        >
          <p>It disappears from the client’s Home at once.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
