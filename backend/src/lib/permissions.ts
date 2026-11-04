import { mfaRequired } from './mfa.ts'
import { CLIENT_CAN } from './scope.ts'

/*
 * P172–P174: the permission matrix, as data. It describes what the code enforces; roles are fixed (D44, D47),
 * so this is read-only. Keep it in step with the `requireRole` / `loadClient(... 'manage')` checks.
 */

const AGENCY_CAPABILITIES = [
  { key: 'billing_and_ownership', label: 'Billing, delete agency, transfer ownership', roles: ['owner'] },
  { key: 'team', label: 'Invite, change roles, disable and remove team members', roles: ['owner', 'admin'] },
  { key: 'agency_settings', label: 'Agency profile and workspace settings', roles: ['owner', 'admin'] },
  { key: 'all_clients', label: 'See every client', roles: ['owner', 'admin'] },
  { key: 'create_clients', label: 'Create clients (and be assigned to them)', roles: ['owner', 'admin', 'manager'] },
  { key: 'manage_clients', label: 'Client settings, members, access, integrations (assigned clients)', roles: ['owner', 'admin', 'manager'] },
  { key: 'internal_review', label: 'Internal approval (or the assigned reviewer)', roles: ['owner', 'admin', 'manager'] },
  { key: 'plans_campaigns', label: 'Create plans and campaigns, send plans', roles: ['owner', 'admin', 'manager'] },
  { key: 'brand_dna', label: 'Edit Brand DNA and creative guidelines', roles: ['owner', 'admin', 'manager'] },
  { key: 'templates', label: 'Create and edit templates', roles: ['owner', 'admin', 'manager'] },
  { key: 'content', label: 'Create and edit content, upload versions, send to client', roles: ['owner', 'admin', 'manager', 'member'] },
  { key: 'tasks', label: 'Work tasks, reply to feedback, internal notes', roles: ['owner', 'admin', 'manager', 'member'] },
  { key: 'publish', label: 'Schedule and publish (Members/Managers with “can publish”)', roles: ['owner', 'admin'], flag: 'canPublish' },
] as const

const CLIENT_CAPABILITIES = [
  { key: 'view', label: 'See content, plans, meetings, Brand DNA', roles: ['admin', 'approver', 'contributor', 'viewer'] },
  { key: 'feedback', label: 'Review and send feedback', roles: CLIENT_CAN.feedback },
  { key: 'approve', label: 'Approve / request changes', roles: CLIENT_CAN.approve },
  { key: 'upload', label: 'Upload to requests and the library', roles: CLIENT_CAN.upload },
  { key: 'editBrand', label: 'Edit Brand DNA', roles: CLIENT_CAN.editBrand },
  { key: 'invite', label: 'Invite colleagues, change their roles', roles: CLIENT_CAN.invite },
] as const

export const PERMISSION_MATRIX = {
  agency: { roles: ['owner', 'admin', 'manager', 'member'], capabilities: AGENCY_CAPABILITIES },
  client: { roles: ['admin', 'approver', 'contributor', 'viewer'], capabilities: CLIENT_CAPABILITIES },
  notes: [
    'Managers and Members only see clients they are assigned to (effective permission = role ∩ client access).',
    // Only true while 2FA is switched on (MFA_REQUIRED).
    ...(mfaRequired() ? ['Agency owners and platform admins must sign in with two-factor authentication.'] : []),
  ],
}
