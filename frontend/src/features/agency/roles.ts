import type { AgencyRole, ClientRole } from './api'

// Mirrors backend `lib/scope.ts`. The server enforces every rule; these only hide buttons that would be refused.

/** Owner and Admin: team, settings, every client (D44). */
export const isAgencyAdmin = (role: AgencyRole) => role === 'owner' || role === 'admin'
/** Owner, Admin and Manager: create clients, manage client people and contracts. */
export const isManagerPlus = (role: AgencyRole) => role !== 'member'

/** Roles that can be given by invite or role change. Ownership moves only by transfer. */
export const ASSIGNABLE_ROLES = ['admin', 'manager', 'member'] as const satisfies readonly AgencyRole[]

export const agencyRoleLabel: Record<AgencyRole, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', member: 'Member' }
export const agencyRoleHint: Record<AgencyRole, string> = {
  owner: 'Everything, including billing and transferring ownership.',
  admin: 'Team, settings and every client.',
  manager: 'Assigned clients: approve internally, send to client, manage client people.',
  member: 'Assigned clients: create content, upload versions, work on tasks.',
}

export const clientRoleLabel: Record<ClientRole, string> = { admin: 'Admin', approver: 'Approver', contributor: 'Contributor', viewer: 'Viewer' }
export const clientRoleHint: Record<ClientRole, string> = {
  admin: 'Approves, gives feedback, edits the brand and invites colleagues.',
  approver: 'Approves or requests changes, gives feedback, uploads.',
  contributor: 'Gives feedback and uploads, but can’t approve.',
  viewer: 'Can look, but not comment or approve.',
}
