import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { FORMATS, PLATFORMS, PRIORITIES, type Format, type Platform, type Priority } from '@/features/content/api'
import { formatLabel, platformLabel, priorityLabel } from '@/features/content/labels'
import { cn } from '@/lib/cn'
import { fieldErrors } from '@/lib/errors'
import { FILE_CATEGORIES, TEMPLATE_TYPES, templatesApi, type FileCategory, type Template, type TemplateBodies, type TemplateTask, type TemplateType } from './api'
import { emptyBody, fileCategoryLabel, NOT_A_TASK, templateTypeLabel } from './labels'

/** Create a template or edit one (with `rev`). The body editor matches the template's type. */
export function TemplateDialog({ template, onClose, onSaved, onReload }: { template?: Template; onClose: () => void; onSaved: () => void; onReload?: () => void }) {
  const [type, setType] = useState<TemplateType>(template?.type ?? 'task_list')
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  // One body per type, so switching type while creating doesn't lose what was typed.
  const [bodies, setBodies] = useState<TemplateBodies>(() => ({ ...emptyBody, ...(template ? { [template.type]: template.body } : {}) }) as TemplateBodies)
  const body = bodies[type]
  const setBody = <T extends TemplateType>(t: T, next: TemplateBodies[T]) => setBodies((b) => ({ ...b, [t]: next }))

  const save = useMutation({
    mutationFn: () =>
      template
        ? templatesApi.update(template._id, { rev: template.rev, name: name.trim(), description: description.trim(), body })
        : templatesApi.create({ type, name: name.trim(), description: description.trim(), body }),
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title={template ? `Edit ${template.name}` : 'New template'}
      description={templateTypeLabel[type].hint}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="template-form" loading={save.isPending} disabled={!name.trim()}>
            {template ? 'Save' : 'Create template'}
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!template && (
          <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <legend className="mb-1.5 text-xs font-medium text-text-2">Type</legend>
            {TEMPLATE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={cn('rounded-lg border px-3 py-2 text-[13px]', type === t ? 'border-brand-border bg-green-soft/40 font-medium' : 'border-border-strong hover:bg-surface')}
              >
                {templateTypeLabel[t].label}
              </button>
            ))}
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="tpl-name" error={errors.name}>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="e.g. Instagram carousel" />
          </Field>
          <Field label="Description (optional)" htmlFor="tpl-desc" error={errors.description}>
            <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
        </div>

        {type === 'content' && <ContentBody value={bodies.content} onChange={(v) => setBody('content', v)} />}
        {type === 'campaign' && <CampaignBody value={bodies.campaign} onChange={(v) => setBody('campaign', v)} />}
        {type === 'task_list' && <TaskRows tasks={bodies.task_list.tasks} onChange={(tasks) => setBody('task_list', { tasks })} required />}
        {type === 'request' && <RequestBody value={bodies.request} onChange={(v) => setBody('request', v)} />}

        {save.isError &&
          (Object.keys(errors).length ? (
            <p className="text-[13px] text-negative">{Object.values(errors)[0]}</p>
          ) : (
            <FormError error={save.error} onReload={onReload} />
          ))}
      </form>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
      <legend className="pr-2 text-xs font-semibold tracking-wide text-text-3 uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Production tasks with a due offset in days. Review/approve/schedule/publish steps aren't tasks (D55). */
function TaskRows({ tasks, onChange, required }: { tasks: TemplateTask[]; onChange: (t: TemplateTask[]) => void; required?: boolean }) {
  const set = (i: number, patch: Partial<TemplateTask>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  return (
    <Section title="Production tasks">
      <p className="-mt-2 text-xs text-text-3">Due dates count from when the template is used. Review, approval, scheduling and publishing are steps of the content itself, so they can’t be tasks.</p>
      {tasks.length === 0 && !required && <p className="text-[13px] text-text-3">No tasks. Add the steps your team always does.</p>}
      <ol className="flex flex-col gap-2">
        {tasks.map((t, i) => {
          const bad = NOT_A_TASK.test(t.title)
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-text-4">{i + 1}</span>
                <Input value={t.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="e.g. Write copy" maxLength={200} aria-label={`Task ${i + 1} title`} aria-invalid={bad} />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-text-3">
                  Day
                  <Input type="number" min={-365} max={365} value={t.dueOffsetDays} onChange={(e) => set(i, { dueOffsetDays: Number(e.target.value) })} className="w-20" aria-label={`Task ${i + 1} due offset in days`} />
                </label>
                <Button size="sm" variant="ghost" aria-label={`Remove task ${i + 1}`} disabled={required && tasks.length === 1} onClick={() => onChange(tasks.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              </div>
              {bad && <p className="pl-7 text-xs text-negative">That’s a content step, not a task.</p>}
            </li>
          )
        })}
      </ol>
      <Button size="sm" className="self-start" disabled={tasks.length >= 50} onClick={() => onChange([...tasks, { title: '', description: '', dueOffsetDays: tasks.at(-1)?.dueOffsetDays ?? 0 }])}>
        <Plus size={14} /> Add task
      </Button>
    </Section>
  )
}

function ContentBody({ value: v, onChange }: { value: TemplateBodies['content']; onChange: (v: TemplateBodies['content']) => void }) {
  const text = (k: 'idea' | 'concept' | 'objective' | 'brief') => (e: { target: { value: string } }) => onChange({ ...v, [k]: e.target.value })
  return (
    <>
      <Section title="Prefilled fields">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Platform" htmlFor="tpl-platform">
            <Select id="tpl-platform" value={v.platform ?? ''} onChange={(e) => onChange({ ...v, platform: (e.target.value || undefined) as Platform | undefined })}>
              <option value="">Choose each time</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format" htmlFor="tpl-format">
            <Select id="tpl-format" value={v.format ?? ''} onChange={(e) => onChange({ ...v, format: (e.target.value || undefined) as Format | undefined })}>
              <option value="">Choose each time</option>
              {FORMATS.map((x) => (
                <option key={x} value={x}>
                  {formatLabel[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="tpl-priority">
            <Select id="tpl-priority" value={v.priority ?? ''} onChange={(e) => onChange({ ...v, priority: (e.target.value || undefined) as Priority | undefined })}>
              <option value="">Normal</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Brief" htmlFor="tpl-brief">
          <Textarea id="tpl-brief" value={v.brief} onChange={text('brief')} maxLength={20_000} className="min-h-24" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Idea" htmlFor="tpl-idea">
            <Textarea id="tpl-idea" value={v.idea} onChange={text('idea')} maxLength={5000} />
          </Field>
          <Field label="Concept" htmlFor="tpl-concept">
            <Textarea id="tpl-concept" value={v.concept} onChange={text('concept')} maxLength={5000} />
          </Field>
          <Field label="Objective" htmlFor="tpl-objective">
            <Textarea id="tpl-objective" value={v.objective} onChange={text('objective')} maxLength={2000} />
          </Field>
        </div>
      </Section>
      <TaskRows tasks={v.tasks} onChange={(tasks) => onChange({ ...v, tasks })} />
    </>
  )
}

function CampaignBody({ value: v, onChange }: { value: TemplateBodies['campaign']; onChange: (v: TemplateBodies['campaign']) => void }) {
  const brief = (k: keyof TemplateBodies['campaign']['brief']) => (e: { target: { value: string } }) => onChange({ ...v, brief: { ...v.brief, [k]: e.target.value } })
  return (
    <>
      <Section title="Campaign">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Objective" htmlFor="tpl-c-objective">
            <Textarea id="tpl-c-objective" value={v.objective} onChange={(e) => onChange({ ...v, objective: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="Audience" htmlFor="tpl-c-audience">
            <Textarea id="tpl-c-audience" value={v.audience} onChange={(e) => onChange({ ...v, audience: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="Key message" htmlFor="tpl-c-message">
            <Textarea id="tpl-c-message" value={v.keyMessage} onChange={(e) => onChange({ ...v, keyMessage: e.target.value })} maxLength={2000} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-text-2">Platforms</legend>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => {
              const on = v.platforms.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...v, platforms: on ? v.platforms.filter((x) => x !== p) : [...v.platforms, p] })}
                  className={cn('h-8 rounded-full border px-3 text-xs', on ? 'border-brand bg-brand text-white' : 'border-border-strong bg-white text-text-2 hover:bg-surface')}
                >
                  {platformLabel[p]}
                </button>
              )
            })}
          </div>
        </fieldset>
      </Section>
      <Section title="Brief">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['background', 'Background'],
              ['strategy', 'Strategy'],
              ['deliverables', 'Deliverables'],
              ['references', 'References'],
              ['successCriteria', 'Success criteria'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`tpl-b-${k}`}>
              <Textarea id={`tpl-b-${k}`} value={v.brief[k]} onChange={brief(k)} />
            </Field>
          ))}
        </div>
      </Section>
    </>
  )
}

function RequestBody({ value: v, onChange }: { value: TemplateBodies['request']; onChange: (v: TemplateBodies['request']) => void }) {
  return (
    <Section title="The request">
      <Field label="What you need" htmlFor="tpl-r-title">
        <Input id="tpl-r-title" value={v.title} onChange={(e) => onChange({ ...v, title: e.target.value })} maxLength={200} placeholder="e.g. Logo files in SVG" />
      </Field>
      <Field label="Details" htmlFor="tpl-r-desc">
        <Textarea id="tpl-r-desc" value={v.description} onChange={(e) => onChange({ ...v, description: e.target.value })} maxLength={5000} />
      </Field>
      <Field label="Why you need it" htmlFor="tpl-r-why" hint="Clients act faster when they know why.">
        <Textarea id="tpl-r-why" value={v.why} onChange={(e) => onChange({ ...v, why: e.target.value })} maxLength={2000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Files go to" htmlFor="tpl-r-cat" hint="The category in the client’s resource library.">
          <Select id="tpl-r-cat" value={v.uploadCategory} onChange={(e) => onChange({ ...v, uploadCategory: e.target.value as FileCategory })}>
            {FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {fileCategoryLabel[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due after (days)" htmlFor="tpl-r-due">
          <Input id="tpl-r-due" type="number" min={0} max={365} value={v.dueOffsetDays} onChange={(e) => onChange({ ...v, dueOffsetDays: Number(e.target.value) })} />
        </Field>
      </div>
    </Section>
  )
}
