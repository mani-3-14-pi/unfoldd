import type { Tone } from '@/components/ui/Pill'
import type { ClientAction, ClientStatus, Health } from './api'

export const clientStatusLabel: Record<ClientStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
}
export const clientStatusTone: Record<ClientStatus, Tone> = { onboarding: 'blue', active: 'green', paused: 'amber', completed: 'indigo', archived: 'gray' }

export const healthLabel: Record<Health, string> = { on_track: 'On track', needs_attention: 'Needs attention', blocked: 'Blocked' }
export const healthTone: Record<Health, Tone> = { on_track: 'green', needs_attention: 'amber', blocked: 'red' }

/** Which status actions make sense from each status (backend CLIENT_TRANSITIONS, §6.10). */
export const actionsFor = (status: ClientStatus): ClientAction[] =>
  ({
    onboarding: ['activate', 'archive'],
    active: ['pause', 'complete', 'archive'],
    paused: ['activate', 'complete', 'archive'],
    completed: ['archive'],
    archived: ['restore'],
  })[status] as ClientAction[]

export const clientActionCopy: Record<ClientAction, { label: string; done: string; confirm?: string }> = {
  activate: { label: 'Mark active', done: 'is active' },
  pause: { label: 'Pause', done: 'is paused' },
  complete: { label: 'Mark completed', done: 'is completed' },
  archive: {
    label: 'Archive',
    done: 'was archived',
    confirm: 'Archived clients are read-only for everyone, on both sides. You can restore it later.',
  },
  restore: { label: 'Restore', done: 'was restored' },
}
