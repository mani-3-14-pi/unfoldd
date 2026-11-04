import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { getSettings, SettingsModel } from './settings.model.ts'

export const settingsAdminRouter = Router()

settingsAdminRouter.get('/', async (_req, res) => {
  res.json({ settings: await getSettings() })
})

const updateSchema = z.object({
  signups: z.object({ enabled: z.boolean(), autoApprove: z.boolean() }),
  supportSessionMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(480, 'At most 8 hours'),
})

settingsAdminRouter.put('/', async (req, res) => {
  const input = updateSchema.parse(req.body)
  const before = await getSettings()
  await SettingsModel.updateOne({ key: 'platform' }, { $set: input })

  const changes: string[] = []
  if (before.signups.enabled !== input.signups.enabled) changes.push(`signups ${input.signups.enabled ? 'opened' : 'closed'}`)
  if (before.signups.autoApprove !== input.signups.autoApprove) changes.push(`auto-approve ${input.signups.autoApprove ? 'on' : 'off'}`)
  if (before.supportSessionMinutes !== input.supportSessionMinutes) changes.push(`support sessions ${input.supportSessionMinutes} min`)
  if (changes.length) {
    await logActivity(req, {
      action: 'settings.updated',
      message: `${req.admin!.name} updated platform settings: ${changes.join(', ')}`,
      target: { type: 'settings', label: 'Platform settings' },
      meta: { before, after: input },
    })
  }
  res.json({ settings: await getSettings() })
})
