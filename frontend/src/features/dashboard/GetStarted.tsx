import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Settings, Store, Users } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '@/components/ui/buttonClass'
import { Card } from '@/components/ui/Card'
import { isAgencyAdmin, isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { teamApi } from '@/features/team/api'
import { profileKey, workspaceApi } from '@/features/workspace/api'
import { cn } from '@/lib/cn'

/** The first-time setup checklist (P02). Shows nothing once every step this person can do is done. */
export function GetStarted() {
  const s = useAgencySession()
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'home'], queryFn: () => clientsApi.list('sort=newest&pageSize=10') })
  const team = useQuery({ queryKey: ['agency', 'team', 'members', 'home'], queryFn: () => teamApi.members('pageSize=10') })
  const profile = useQuery({ queryKey: profileKey, queryFn: workspaceApi.profile, enabled: isAgencyAdmin(s.role) })

  const steps = [
    { done: true, title: 'Create your agency', text: `${s.agency.name} is set up.`, icon: Check },
    { done: (team.data?.total ?? 0) > 1, title: 'Add your team', text: 'Invite designers, copywriters and managers.', to: '/app/team', icon: Users, show: isAgencyAdmin(s.role) },
    { done: (clients.data?.total ?? 0) > 0, title: 'Add a client', text: 'One brand you work for, then invite their people.', to: '/app/clients', icon: Store, show: isManagerPlus(s.role) },
    {
      // The profile's revision moves past 1 once someone has saved the workspace settings.
      done: (profile.data?.agency.rev ?? 1) > 1,
      title: 'Set up your workspace',
      text: 'Timezone, logo, and the review and revision defaults for new clients.',
      to: '/app/settings',
      icon: Settings,
      show: isAgencyAdmin(s.role),
    },
  ].filter((step) => step.show !== false)

  const loaded = clients.isSuccess && team.isSuccess && (!isAgencyAdmin(s.role) || profile.isSuccess)
  if (!loaded || steps.length <= 1 || steps.every((step) => step.done)) return null

  return (
    <Card title="Get started" description={`${steps.filter((st) => st.done).length} of ${steps.length} done`}>
      <ol className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
        {steps.map((step) => (
          <li key={step.title} className="flex items-center gap-3 px-5 py-3.5">
            <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', step.done ? 'bg-green-soft text-green-ink' : 'border border-border-strong bg-white text-text-3')}>
              {step.done ? <Check size={17} strokeWidth={2.2} /> : <step.icon size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('text-[13px] font-medium', step.done && 'text-text-3 line-through')}>{step.title}</div>
              <div className="text-xs text-text-3">{step.text}</div>
            </div>
            {!step.done && step.to && (
              <Link to={step.to} className={buttonClass('secondary', 'sm')} aria-label={`Start: ${step.title}`}>
                <ArrowRight size={14} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
