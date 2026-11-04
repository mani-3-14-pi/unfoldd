import { useQuery } from '@tanstack/react-query'
import { Field, Select } from '@/components/ui/Field'
import { api } from '@/lib/api'
import type { Page } from '@/types/api'

export interface TemplateSummary {
  _id: string
  type: 'content' | 'campaign' | 'task_list' | 'request'
  name: string
  description: string
}

/**
 * "Start from a template" (P140–P144). Templates only prefill fields (D55); the server applies them on create.
 * Hidden when the agency has no template of this type.
 */
export function TemplateSelect({ type, value, onChange }: { type: TemplateSummary['type']; value: string; onChange: (id: string) => void }) {
  const templates = useQuery({
    queryKey: ['agency', 'templates', 'picker', type],
    queryFn: () => api<Page<TemplateSummary>>(`/templates?type=${type}&pageSize=100`),
    staleTime: 60_000,
  })
  if (!templates.data?.items.length) return null
  const picked = templates.data.items.find((t) => t._id === value)
  return (
    <Field label="Template (optional)" htmlFor={`tpl-${type}`} hint={picked?.description || 'Prefills the fields you leave empty.'}>
      <Select id={`tpl-${type}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No template</option>
        {templates.data.items.map((t) => (
          <option key={t._id} value={t._id}>
            {t.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}
