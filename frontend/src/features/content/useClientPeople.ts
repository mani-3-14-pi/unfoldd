import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/features/clients/api'

/** People who can own or review content on a client: everyone assigned to it, plus owners and admins. */
export function useClientPeople(clientId: string) {
  return useQuery({
    queryKey: ['agency', 'clients', 'access', clientId],
    queryFn: () => clientsApi.access(clientId),
    enabled: !!clientId,
    select: (d) => {
      const all = [...d.alwaysVisibleTo.map((a) => a.user), ...d.items.filter((r) => r.membership?.status !== 'disabled').map((r) => r.user)]
      return [...new Map(all.map((u) => [u._id, u])).values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}
