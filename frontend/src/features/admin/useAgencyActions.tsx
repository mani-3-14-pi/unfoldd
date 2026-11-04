import { useState } from 'react'
import { Eye } from 'lucide-react'
import type { MenuItem } from '@/components/ui/Menu'
import { AgencyActionDialog } from './AgencyActionDialog'
import { actionCopy, actionsFor, type Action, type Target } from './agencyActions'

/**
 * Agency status changes and the support view, with their confirmation dialogs.
 * Render `dialog` once; use `run(action, agency)` or `menuItems(agency)` to start one.
 */
export function useAgencyActions() {
  const [pending, setPending] = useState<{ action: Action; agency: Target } | null>(null)

  const menuItems = (agency: Target, opts: { view?: boolean } = {}): MenuItem[] => [
    ...(opts.view ? [{ label: 'View details', icon: Eye, to: `/admin/agencies/${agency._id}` }] : []),
    { label: actionCopy.impersonate.label, icon: actionCopy.impersonate.icon, onSelect: () => setPending({ action: 'impersonate', agency }) },
    ...actionsFor(agency.status).map((action, i) => ({
      label: actionCopy[action].label,
      icon: actionCopy[action].icon,
      tone: actionCopy[action].variant === 'danger' ? ('danger' as const) : undefined,
      separated: i === 0,
      onSelect: () => setPending({ action, agency }),
    })),
  ]

  return {
    run: (action: Action, agency: Target) => setPending({ action, agency }),
    menuItems,
    labelOf: (action: Action) => actionCopy[action].label,
    iconOf: (action: Action) => actionCopy[action].icon,
    dialog: pending && <AgencyActionDialog {...pending} onClose={() => setPending(null)} />,
  }
}
