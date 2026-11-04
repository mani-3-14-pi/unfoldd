import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { contentApi, PRIORITIES, type Priority } from '@/features/content/api'
import { priorityLabel } from '@/features/content/labels'
import { useClientPeople } from '@/features/content/useClientPeople'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { fieldErrors } from '@/lib/errors'
import { tasksApi, type Task } from './api'

/** New task, or edit one (with `rev`). The owner must have access to the task's client. */
export function TaskFormDialog({
  task,
  clientId: fixedClient,
  contentId: fixedContent,
  onClose,
  onSaved,
  onReload,
}: {
  task?: Task
  clientId?: string
  contentId?: string
  onClose: () => void
  onSaved: (task: Task) => void
  onReload?: () => void
}) {
  const s = useAgencySession()
  const idem = useIdempotencyKey()
  const [clientId, setClientId] = useState(task?.client ?? fixedClient ?? '')
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name'), enabled: !task })
  const contents = useQuery({
    queryKey: ['agency', 'content', 'list', 'picker', clientId],
    queryFn: () => contentApi.list(`client=${clientId}&pageSize=100&sort=updated`),
    enabled: !task && !!clientId,
  })
  const people = useClientPeople(clientId)

  const [f, setF] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    owner: task ? (task.owner ?? '') : s.user.id,
    due: task?.due ?? '',
    priority: (task?.priority ?? 'normal') as Priority,
    content: fixedContent ?? '',
  })
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      const body = { title: f.title.trim(), description: f.description, owner: f.owner || null, due: f.due, priority: f.priority }
      if (task) return (await tasksApi.update(task._id, { ...body, rev: task.rev })).task
      return (await tasksApi.create({ ...body, client: clientId, ...(f.content ? { content: f.content } : {}) }, idem.key)).task
    },
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title={task ? 'Edit task' : 'New task'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="task-form" loading={save.isPending} disabled={!clientId}>
            {task ? 'Save' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!task && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="tk-client" error={errors.client}>
              <Select
                id="tk-client"
                value={clientId}
                disabled={!!fixedClient}
                onChange={(e) => {
                  setClientId(e.target.value)
                  setF((x) => ({ ...x, content: '' }))
                }}
              >
                <option value="">Choose a client…</option>
                {clients.data?.items.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.brandName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Content (optional)" htmlFor="tk-content" error={errors.content}>
              <Select id="tk-content" value={f.content} onChange={set('content')} disabled={!clientId || !!fixedContent}>
                <option value="">Not about one piece</option>
                {contents.data?.items.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Title" htmlFor="tk-title" error={errors.title}>
          <Input id="tk-title" value={f.title} onChange={set('title')} maxLength={200} autoFocus aria-invalid={!!errors.title} placeholder="e.g. Write captions for the Diwali carousel" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner" htmlFor="tk-owner" error={errors.owner}>
            <Select id="tk-owner" value={f.owner} onChange={set('owner')} disabled={!clientId}>
              <option value="">No one</option>
              {people.data?.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                  {u._id === s.user.id ? ' (you)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor="tk-due" error={errors.due}>
            <Input id="tk-due" type="date" value={f.due} onChange={set('due')} />
          </Field>
          <Field label="Priority" htmlFor="tk-priority" error={errors.priority}>
            <Select id="tk-priority" value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="tk-description" error={errors.description}>
          <Textarea id="tk-description" value={f.description} onChange={set('description')} maxLength={20_000} className="min-h-24" />
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
