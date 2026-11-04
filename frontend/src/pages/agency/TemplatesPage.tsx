import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu } from '@/components/ui/Menu'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { TEMPLATE_TYPES, templatesApi, type Template } from '@/features/templates/api'
import { templateTypeLabel } from '@/features/templates/labels'
import { TemplateDialog } from '@/features/templates/TemplateDialog'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { plural, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/** What a template sets up, in a few words. */
function summary(t: Template) {
  switch (t.type) {
    case 'task_list':
      return plural((t as Template<'task_list'>).body.tasks.length, 'task')
    case 'content': {
      const b = (t as Template<'content'>).body
      return [b.platform && platformLabel[b.platform], b.format && formatLabel[b.format], b.tasks.length ? plural(b.tasks.length, 'task') : null].filter(Boolean).join(' · ') || 'Prefills the brief'
    }
    case 'campaign':
      return (t as Template<'campaign'>).body.objective || 'Prefills the brief'
    case 'request':
      return (t as Template<'request'>).body.title
  }
}

/** P140–P144: reusable starting points. Everyone can use them; Owner, Admin and Manager maintain them. */
export function TemplatesPage() {
  const s = useAgencySession()
  const state = useListState()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
  const manage = isManagerPlus(s.role)

  const query = useQuery({
    queryKey: ['agency', 'templates', apiQuery(state.params)],
    queryFn: () => templatesApi.list(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'templates'] })

  const columns: Column<Template>[] = [
    { key: 'name', header: 'Template', className: 'w-[36%]', cell: (t) => <CellText primary={t.name} secondary={t.description || undefined} /> },
    { key: 'type', header: 'Type', cell: (t) => <span className="text-text-2">{templateTypeLabel[t.type].label}</span> },
    { key: 'what', header: 'Sets up', cell: (t) => <span className="line-clamp-1 text-text-2">{summary(t)}</span> },
    { key: 'updated', header: 'Updated', cell: (t) => <span className="text-text-2">{timeAgo(t.updatedAt)}</span> },
    ...(manage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-12 text-right',
            cell: (t: Template) => (
              <Menu
                label={`Actions for ${t.name}`}
                heading={t.name}
                items={[
                  { label: 'Edit', icon: Pencil, onSelect: () => setEditing(t) },
                  { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(t), separated: true },
                ]}
                className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
              >
                <EllipsisVertical size={17} />
              </Menu>
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Templates"
        description="Starting points for content, campaigns, task lists and client requests. They fill in fields and add tasks; they never change how content moves."
        actions={
          manage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> New template
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <ListToolbar
          state={state}
          searchPlaceholder="Search templates…"
          filters={[]}
          sorts={[{ value: 'name', label: 'Name A–Z' }]}
          defaultSort="name"
          total={data?.total}
          noun="template"
          tabs={{ key: 'type', allLabel: 'All', options: TEMPLATE_TYPES.map((t) => ({ value: t, label: templateTypeLabel[t].label })) }}
        />
        <DataTable
          label="Templates"
          columns={columns}
          rows={data?.items}
          rowKey={(t) => t._id}
          loading={query.isPending}
          fetching={query.isPlaceholderData}
          onRowClick={manage ? setEditing : undefined}
          empty={
            query.isError ? (
              <EmptyState title="Couldn’t load templates">{errorMessage(query.error)}</EmptyState>
            ) : (
              <EmptyState
                title="No templates yet"
                action={
                  manage && (
                    <Button variant="primary" onClick={() => setEditing('new')}>
                      <Plus size={16} /> New template
                    </Button>
                  )
                }
              >
                Save the steps your team repeats, like the tasks behind every carousel.
              </EmptyState>
            )
          }
          footer={
            data &&
            data.total > 0 && (
              <Pagination
                {...data}
                noun="templates"
                onPage={(page) => state.update({ page })}
                onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
              />
            )
          }
        />
      </div>

      {editing && (
        <TemplateDialog
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast('Template saved')
            setEditing(null)
            refresh()
          }}
          onReload={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirm="Delete"
          variant="danger"
          action={() => templatesApi.remove(deleting._id)}
          onClose={() => setDeleting(null)}
          onDone={() => {
            toast('Template deleted')
            refresh()
          }}
        >
          <p>Content and tasks already made from it stay as they are.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
