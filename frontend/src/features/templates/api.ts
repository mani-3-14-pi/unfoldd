import { api } from '@/lib/api'
import type { Format, Platform, Priority } from '@/features/content/api'
import type { Page, UpdatedBy } from '@/types/api'

// Agency templates (P140–P144, D55): /api/templates. They prefill fields and generate production tasks;
// they never hold a status or a review / approve / schedule / publish step.

export const TEMPLATE_TYPES = ['content', 'campaign', 'task_list', 'request'] as const
export type TemplateType = (typeof TEMPLATE_TYPES)[number]

export const FILE_CATEGORIES = ['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export interface TemplateTask {
  title: string
  description: string
  /** Days after the template is applied (negative = before the anchor date). */
  dueOffsetDays: number
}

export interface TemplateBodies {
  content: { platform?: Platform; format?: Format; idea: string; concept: string; objective: string; brief: string; priority?: Priority; tasks: TemplateTask[] }
  campaign: {
    objective: string
    audience: string
    keyMessage: string
    platforms: Platform[]
    brief: { background: string; strategy: string; deliverables: string; references: string; successCriteria: string }
  }
  task_list: { tasks: TemplateTask[] }
  request: { title: string; description: string; why: string; uploadCategory: FileCategory; dueOffsetDays: number }
}

export interface Template<T extends TemplateType = TemplateType> {
  _id: string
  type: T
  name: string
  description: string
  body: TemplateBodies[T]
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
  updatedAt: string
}

export const templatesApi = {
  list: (query: string) => api<Page<Template>>(`/templates?${query}`),
  create: (body: { type: TemplateType; name: string; description: string; body: unknown }) => api<{ template: Template }>('/templates', { body }),
  update: (id: string, body: { rev: number; name?: string; description?: string; body?: unknown }) => api<{ template: Template }>(`/templates/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api<void>(`/templates/${id}`, { method: 'DELETE' }),
  /** Generates a task-list or content template's production tasks for a piece of content. */
  apply: (id: string, content: string, anchor?: string) => api<{ tasks: unknown[] }>(`/templates/${id}/apply`, { body: { content, ...(anchor ? { anchor } : {}) } }),
}
