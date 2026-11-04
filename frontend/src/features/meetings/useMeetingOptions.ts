import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/features/clients/api'
import { contentApi } from '@/features/content/api'
import { useClientPeople } from '@/features/content/useClientPeople'
import { api } from '@/lib/api'
import type { Page } from '@/types/api'

/** Who and what a meeting can involve: the agency people on the client, the client's own people, its campaigns and content. */
export function useMeetingOptions(clientId: string) {
  const agency = useClientPeople(clientId)
  const client = useQuery({
    queryKey: ['agency', 'clients', 'members', clientId],
    queryFn: () => clientsApi.members(clientId),
    enabled: !!clientId,
    select: (d) => d.items.filter((m) => m.status === 'active').map((m) => m.user),
  })
  const campaigns = useQuery({
    queryKey: ['agency', 'campaigns', 'picker', clientId],
    queryFn: () => api<Page<{ _id: string; name: string }>>(`/campaigns?client=${clientId}&pageSize=100`),
    enabled: !!clientId,
    select: (d) => d.items,
  })
  const content = useQuery({
    queryKey: ['agency', 'content', 'list', 'picker', clientId],
    queryFn: () => contentApi.list(`client=${clientId}&pageSize=100&sort=updated`),
    enabled: !!clientId,
    select: (d) => d.items,
  })
  return { agency, client, campaigns, content }
}
