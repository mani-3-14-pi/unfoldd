import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { Card, EmptyState } from '@/components/ui/Card'
import { errorMessage } from '@/lib/errors'
import { permissionsApi, type Capability } from './api'

const title = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

/**
 * P172–P174: what each agency and client role can do, read-only. Roles are fixed (D44, D47); "can publish" is the
 * one per-person switch, set on the Team page.
 */
export function PermissionsCard() {
  const matrix = useQuery({ queryKey: ['agency', 'permissions'], queryFn: permissionsApi.matrix, staleTime: Infinity })
  return (
    <Card title="Roles and permissions" description="What each role can do. Roles are fixed, so there’s nothing to configure here.">
      {matrix.isPending ? (
        <div className="h-40" />
      ) : matrix.isError ? (
        <EmptyState title="Couldn’t load permissions">{errorMessage(matrix.error)}</EmptyState>
      ) : (
        <div className="flex flex-col gap-6 px-5 py-4">
          <Matrix caption="Your agency" roles={matrix.data.agency.roles} capabilities={matrix.data.agency.capabilities} />
          <Matrix caption="Client people" roles={matrix.data.client.roles} capabilities={matrix.data.client.capabilities} />
          {matrix.data.notes.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-text-3">
              {matrix.data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function Matrix({ caption, roles, capabilities }: { caption: string; roles: string[]; capabilities: Capability[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="mb-2 text-left text-xs font-semibold tracking-wide text-text-3 uppercase">{caption}</caption>
        <thead>
          <tr className="text-[11px] text-text-3">
            <th scope="col" className="py-2 pr-4 font-normal">
              Can
            </th>
            {roles.map((r) => (
              <th key={r} scope="col" className="w-24 px-2 py-2 text-center font-normal">
                {title(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {capabilities.map((c) => (
            <tr key={c.key} className="border-t border-border">
              <th scope="row" className="py-2 pr-4 font-normal">
                {c.label}
              </th>
              {roles.map((r) => (
                <td key={r} className="px-2 py-2 text-center">
                  {c.roles.includes(r) ? (
                    <Check size={15} className="inline text-positive" aria-label="Yes" />
                  ) : c.flag ? (
                    <span className="text-[11px] text-text-3">With “can publish”</span>
                  ) : (
                    <Minus size={15} className="inline text-text-4" aria-label="No" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
