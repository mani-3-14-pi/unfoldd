import { MutationCache, QueryCache, QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/Toaster'
import { adminMeKey } from '@/features/admin/api'
import { sessionKey } from '@/features/agency/api'
import { ApiError } from '@/lib/api'
import { router } from './router'

const same = (a: readonly unknown[], key?: QueryKey) => key?.[0] === a[0] && key?.[1] === a[1]

// When a session expires mid-use, re-check it so the shell sends the user to log in.
// (Not for the session check itself, or a 401 there would re-trigger it forever.)
const onAuthError = (error: unknown, key?: QueryKey) => {
  if (!(error instanceof ApiError) || error.status !== 401) return
  const path = location.pathname
  if (path.startsWith('/admin') && !same(adminMeKey, key)) void queryClient.invalidateQueries({ queryKey: adminMeKey })
  else if ((path.startsWith('/app') || path.startsWith('/c')) && !same(sessionKey, key)) void queryClient.invalidateQueries({ queryKey: sessionKey })
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => onAuthError(error, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (error) => onAuthError(error) }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't retry what the server rejected on purpose (401/403/404/409 …).
      retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}
