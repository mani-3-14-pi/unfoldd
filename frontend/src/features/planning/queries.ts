import { clientsApi } from '@/features/clients/api'

/** Every client the person can see, for pickers. Agencies stay well under 100 active clients. */
export const clientPickerQuery = {
  queryKey: ['agency', 'clients', 'list', 'picker'],
  queryFn: () => clientsApi.list('pageSize=100&sort=name'),
  staleTime: 60_000,
}
