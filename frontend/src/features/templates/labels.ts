import type { FileCategory, TemplateBodies, TemplateType } from './api'

export const templateTypeLabel: Record<TemplateType, { label: string; hint: string }> = {
  content: { label: 'Content', hint: 'Prefills a new post’s platform, format and brief, and adds its production tasks.' },
  campaign: { label: 'Campaign', hint: 'Prefills a campaign’s objective, audience and brief.' },
  task_list: { label: 'Task list', hint: 'A list of production tasks to add to any piece of content.' },
  request: { label: 'Request', hint: 'Something you often need from clients, like brand assets or product photos.' },
}

export const fileCategoryLabel: Record<FileCategory, string> = {
  brand: 'Brand',
  photography: 'Photography',
  video: 'Video',
  documents: 'Documents',
  fonts: 'Fonts',
  product: 'Product',
  existing_creatives: 'Existing creatives',
  other: 'Other',
}

/** A fresh body for each type, matching the server's defaults. */
export const emptyBody: { [T in TemplateType]: TemplateBodies[T] } = {
  content: { idea: '', concept: '', objective: '', brief: '', tasks: [] },
  campaign: { objective: '', audience: '', keyMessage: '', platforms: [], brief: { background: '', strategy: '', deliverables: '', references: '', successCriteria: '' } },
  task_list: { tasks: [{ title: '', description: '', dueOffsetDays: 0 }] },
  request: { title: '', description: '', why: '', uploadCategory: 'other', dueOffsetDays: 7 },
}

/** D55: review, approval, scheduling and publishing are content states, never template tasks. The server refuses them too. */
export const NOT_A_TASK = /\b(review|approv\w*|schedul\w*|publish\w*|send to client)\b/i
