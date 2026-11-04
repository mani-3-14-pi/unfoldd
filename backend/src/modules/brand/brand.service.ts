import type { Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { notify } from '../../lib/notify.ts'
import { currentUser } from '../../lib/scope.ts'
import { AppError } from '../../utils/AppError.ts'
import { ClientModel } from '../clients/client.model.ts'
import { RequestModel } from '../requests/request.model.ts'
import { BrandDnaModel, ONBOARDING_STEPS, PERSONALITY_AXES, STYLE_TAGS, type BrandSection, type OnboardingStep } from './brand.model.ts'

const text = (max: number) => z.string().trim().max(max).default('')
const url = z.union([z.url().max(500), z.literal('')]).default('')
const handle = z.string().trim().max(200).default('')
const axisKeys = PERSONALITY_AXES.map((a) => a.key) as [string, ...string[]]

/** What each section may hold (F03–F07, P22). Unknown fields are refused. */
export const SECTION_SCHEMAS: Record<BrandSection, z.ZodType> = {
  intro: z
    .object({
      whatWeDo: text(500),
      standFor: text(500),
      audience: text(500),
      offerings: z.array(z.object({ name: z.string().trim().min(1).max(100), description: text(300) }).strict()).max(30).default([]),
      website: url,
      socials: z.object({ instagram: handle, facebook: handle, linkedin: handle, youtube: handle, x: handle, tiktok: handle, other: z.array(z.string().trim().max(200)).max(10).default([]) }).strict().default({ instagram: '', facebook: '', linkedin: '', youtube: '', x: '', tiktok: '', other: [] }),
    })
    .strict(),
  personality: z
    .object({
      // A continuous 0–100 slider per axis (D42).
      axes: z.record(z.enum(axisKeys), z.number().min(0).max(100)).default({}),
      keywords: text(200),
    })
    .strict(),
  likes: z.object({ tags: z.array(z.enum(STYLE_TAGS)).max(12).default([]), note: text(200) }).strict(),
  dislikes: z.object({ tags: z.array(z.enum(STYLE_TAGS)).max(12).default([]), note: text(200) }).strict(),
  audience: z.object({ primary: text(1000), secondary: text(1000), age: text(200), location: text(500), behaviour: text(1000), interests: text(1000) }).strict(),
  positioning: z.object({ text: text(5000) }).strict(),
  tone: z.object({ text: text(5000) }).strict(),
  visualIdentity: z.object({ text: text(5000) }).strict(),
}

/** The client's Brand DNA, created empty the first time anyone opens it. */
export async function brandFor(client: { _id: Types.ObjectId; agency: Types.ObjectId }) {
  return (await BrandDnaModel.findOneAndUpdate(
    { client: client._id },
    { $setOnInsert: { agency: client.agency, client: client._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean())!
}

/** D72: done ÷ 6. Assets also lists the asset requests still open ("Assets — 2 remaining"). */
export async function onboardingProgress(brand: { client: Types.ObjectId; onboarding?: Record<string, Date | null> | null; onboardingCompletedAt?: Date | null }) {
  const steps = ONBOARDING_STEPS.map((key) => ({ key, completedAt: brand.onboarding?.[key] ?? null }))
  const done = steps.filter((s) => s.completedAt).length
  const assetRequestsOpen = await RequestModel.countDocuments({ client: brand.client, source: 'asset', status: 'open', deletedAt: null })
  return {
    steps,
    done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    assetRequestsOpen,
    // D73: a linear wizard the first time, a hub afterwards.
    mode: brand.onboardingCompletedAt ? 'hub' : 'wizard',
    completedAt: brand.onboardingCompletedAt ?? null,
  }
}

/** Saves one section if its `rev` still matches; the change is logged with before/after (D41, D54). */
export async function saveSection(req: Request, client: { _id: Types.ObjectId; agency: Types.ObjectId; brandName: string }, section: BrandSection, rev: number, raw: unknown) {
  const data = SECTION_SCHEMAS[section].parse(raw) as Record<string, unknown>
  const brand = await brandFor(client)
  const me = currentUser(req)
  const updated = await BrandDnaModel.findOneAndUpdate(
    { _id: brand._id, [`sections.${section}.rev`]: rev },
    {
      $set: { [`sections.${section}.data`]: data, [`sections.${section}.updatedBy`]: { id: me._id, name: me.name, side: me.side }, [`sections.${section}.updatedAt`]: new Date() },
      $inc: { [`sections.${section}.rev`]: 1 },
    },
    { returnDocument: 'after' },
  ).lean()
  if (!updated) {
    const current = (brand.sections as any)?.[section]
    throw new AppError(409, 'stale', `This section was updated by ${current?.updatedBy?.name ?? 'someone else'} since you opened it. Reload to see their changes.`, {
      rev: current?.rev,
      updatedBy: current?.updatedBy,
      updatedAt: current?.updatedAt,
    })
  }
  const before = ((brand.sections as any)?.[section]?.data ?? {}) as Record<string, unknown>
  const changes = diff(before, data, Object.keys({ ...before, ...data }))
  if (changes) {
    const e = await logActivity(req, {
      action: 'brand.section_updated',
      message: `${me.name} updated ${section} in ${client.brandName}’s Brand DNA`,
      agency: client.agency,
      client: client._id,
      visibility: 'client',
      target: { type: 'brand_section', id: brand._id, label: section },
      meta: { section },
      ...changes,
    })
    // D41: the agency hears about client edits.
    if (me.side === 'client') {
      const c = await ClientModel.findById(client._id, { accountManager: 1 }).lean()
      await notify({
        recipients: c?.accountManager ? [c.accountManager] : [],
        audience: 'agency',
        agency: client.agency,
        client: client._id,
        category: 'clients',
        event: 'brand.section_updated',
        title: `${me.name} updated ${client.brandName}’s Brand DNA (${section})`,
        entity: { type: 'client', id: client._id },
        link: `/app/clients/${client._id}/brand`,
        activity: e?._id,
      })
    }
  }
  return updated
}

/** Marks an onboarding step done ("Done" or "Nothing to add"). The sixth one completes onboarding. */
export async function completeStep(req: Request, client: { _id: Types.ObjectId; agency: Types.ObjectId; brandName: string }, step: OnboardingStep) {
  const brand = await brandFor(client)
  const now = new Date()
  const updated = await BrandDnaModel.findOneAndUpdate({ _id: brand._id }, { $set: { [`onboarding.${step}`]: brand.onboarding?.[step] ?? now } }, { returnDocument: 'after' }).lean()
  const progress = await onboardingProgress(updated!)
  if (progress.done === progress.total && !updated!.onboardingCompletedAt) {
    const first = await BrandDnaModel.findOneAndUpdate({ _id: brand._id, onboardingCompletedAt: null }, { $set: { onboardingCompletedAt: now } }, { returnDocument: 'after' }).lean()
    if (first) {
      const me = currentUser(req)
      const e = await logActivity(req, {
        action: 'client.onboarding_completed',
        message: `${client.brandName} completed onboarding`,
        agency: client.agency,
        client: client._id,
        visibility: 'client',
        target: { type: 'client', id: client._id, label: client.brandName },
      })
      const c = await ClientModel.findById(client._id, { accountManager: 1, status: 1 }).lean()
      await notify({
        recipients: c?.accountManager ? [c.accountManager] : [],
        audience: 'agency',
        agency: client.agency,
        client: client._id,
        category: 'clients',
        event: 'client.onboarding_completed',
        title: `${client.brandName} finished onboarding`,
        // Flow 3, step 4: suggest moving the client to active.
        body: c?.status === 'onboarding' ? `${me.name} completed all six sections. You can set the client to active.` : `${me.name} completed all six sections.`,
        entity: { type: 'client', id: client._id },
        link: `/app/clients/${client._id}/brand`,
        activity: e?._id,
      })
      return { brand: first, progress: await onboardingProgress(first) }
    }
  }
  return { brand: updated!, progress }
}

