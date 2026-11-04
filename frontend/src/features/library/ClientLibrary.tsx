import { useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, EllipsisVertical, FileText, FolderOpen, FolderPlus, Lock, Pencil, Trash2, Upload, Users } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { SearchInput } from '@/components/list/SearchInput'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import type { ClientDetail } from '@/features/clients/api'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { FILE_CATEGORIES, libraryApi, libraryKey, type Collection, type FileCategory, type LibraryFile } from './api'
import { categoryLabel, fileSize } from './labels'

/**
 * A client's resource library (P27–P31): every brand asset, request upload and resource in one place (D39),
 * by category and collection. Version files never appear here.
 */
export function ClientLibrary({ client }: { client: ClientDetail }) {
  const qc = useQueryClient()
  const [category, setCategory] = useState<FileCategory | ''>('')
  const [collection, setCollection] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editingCollection, setEditingCollection] = useState<Collection | 'new' | null>(null)
  const [removingCollection, setRemovingCollection] = useState<Collection | null>(null)
  const [filing, setFiling] = useState<LibraryFile | null>(null)
  const [removing, setRemoving] = useState<LibraryFile | null>(null)
  const writable = client.status !== 'archived'

  const overview = useQuery({ queryKey: [...libraryKey(client._id), 'overview'], queryFn: () => libraryApi.overview(client._id) })
  const params = new URLSearchParams({ client: client._id, page: String(page), pageSize: String(pageSize) })
  if (category) params.set('category', category)
  if (collection) params.set('collection', collection)
  if (q) params.set('q', q)
  const files = useQuery({
    queryKey: [...libraryKey(client._id), 'files', params.toString()],
    queryFn: () => libraryApi.files(params.toString()),
    placeholderData: keepPreviousData,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: libraryKey(client._id) })
  const pick = (next: { category?: FileCategory | ''; collection?: string }) => {
    if (next.category !== undefined) setCategory(next.category)
    if (next.collection !== undefined) setCollection(next.collection)
    setPage(1)
  }

  const open = async (f: LibraryFile) => {
    try {
      const { url } = await libraryApi.download(f.id)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const setVisibility = async (f: LibraryFile, visibility: 'internal' | 'client') => {
    try {
      await libraryApi.organise(client._id, f.id, { visibility })
      toast(visibility === 'client' ? `${f.name} is shared with the client` : `${f.name} is team-only now`)
      refresh()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const counts = overview.data?.categories
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined
  const nav = (active: boolean) => cn('flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px]', active ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-text-2 hover:bg-black/4')

  const columns: Column<LibraryFile>[] = [
    {
      key: 'name',
      header: 'File',
      className: 'w-[38%]',
      cell: (f) => (
        <div className="flex items-center gap-3">
          <FileText size={18} className="shrink-0 text-text-3" />
          <CellText primary={<button type="button" onClick={() => void open(f)} className="hover:underline">{f.name}</button>} secondary={`${fileSize(f.size)} · ${f.mimeType}`} />
        </div>
      ),
    },
    { key: 'category', header: 'Category', cell: (f) => <span className="text-text-2">{categoryLabel[f.category]}</span> },
    {
      key: 'collection',
      header: 'Collection',
      cell: (f) => <span className="text-text-2">{overview.data?.collections.find((c) => c._id === f.collection)?.name ?? '—'}</span>,
    },
    {
      key: 'visibility',
      header: 'Shared',
      cell: (f) => (f.visibility === 'client' ? <Pill tone="green">With client</Pill> : <Pill tone="gray">Team only</Pill>),
    },
    { key: 'by', header: 'Added by', cell: (f) => <CellText primary={<span className="font-normal">{f.uploadedBy?.name ?? '—'}</span>} secondary={f.uploadedBy?.side === 'client' ? 'Client' : f.purpose === 'request' ? 'Request' : undefined} /> },
    { key: 'date', header: 'Added', cell: (f) => <span className="text-text-2">{formatDate(f.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12 text-right',
      cell: (f) => (
        <Menu
          label={`Actions for ${f.name}`}
          heading={f.name}
          items={[
            { label: 'Download', icon: Download, onSelect: () => void open(f) },
            ...(writable
              ? [
                  { label: 'Category and collection', icon: FolderOpen, onSelect: () => setFiling(f) },
                  f.visibility === 'client'
                    ? { label: 'Make team-only', icon: Lock, onSelect: () => void setVisibility(f, 'internal') }
                    : { label: 'Share with client', icon: Users, onSelect: () => void setVisibility(f, 'client') },
                  { label: 'Delete', icon: Trash2, tone: 'danger' as const, onSelect: () => setRemoving(f), separated: true },
                ]
              : []),
          ]}
          className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
        >
          <EllipsisVertical size={17} />
        </Menu>
      ),
    },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-5">
        <nav aria-label="Categories" className="flex flex-col gap-0.5">
          <h3 className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Categories</h3>
          <button type="button" className={nav(!category && !collection)} onClick={() => pick({ category: '', collection: '' })}>
            All files <span className="ml-auto text-xs text-text-4">{total ?? ''}</span>
          </button>
          {FILE_CATEGORIES.map((c) => (
            <button key={c} type="button" className={nav(category === c)} onClick={() => pick({ category: c, collection: '' })}>
              {categoryLabel[c]} <span className="ml-auto text-xs text-text-4">{counts?.[c] ?? ''}</span>
            </button>
          ))}
        </nav>
        <nav aria-label="Collections" className="flex flex-col gap-0.5">
          <div className="mb-1 flex items-center justify-between px-2.5">
            <h3 className="text-[11px] font-semibold tracking-wide text-text-3 uppercase">Collections</h3>
            {writable && (
              <button type="button" aria-label="New collection" onClick={() => setEditingCollection('new')} className="grid size-6 place-items-center rounded text-text-3 hover:bg-black/5">
                <FolderPlus size={14} />
              </button>
            )}
          </div>
          {overview.data?.collections.length === 0 && <p className="px-2.5 text-xs text-text-4">No collections yet.</p>}
          {overview.data?.collections.map((c) => (
            <div key={c._id} className="group flex items-center">
              <button type="button" className={nav(collection === c._id)} onClick={() => pick({ collection: c._id, category: '' })}>
                {c.visibility === 'internal' && <Lock size={12} className="shrink-0 text-text-4" aria-label="Team only" />}
                <span className="truncate">{c.name}</span>
                <span className="ml-auto text-xs text-text-4">{c.fileCount}</span>
              </button>
              {writable && (
                <Menu
                  label={`Actions for ${c.name}`}
                  items={[
                    { label: 'Edit', icon: Pencil, onSelect: () => setEditingCollection(c) },
                    { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setRemovingCollection(c) },
                  ]}
                  className="grid size-7 shrink-0 place-items-center rounded text-text-3 hover:bg-black/5"
                >
                  <EllipsisVertical size={14} />
                </Menu>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
            placeholder="Search file names…"
          />
          {writable && <UploadButton clientId={client._id} category={category || 'other'} onUploaded={refresh} />}
        </div>
        <DataTable
          label="Library files"
          columns={columns}
          rows={files.data?.items}
          rowKey={(f) => f.id}
          loading={files.isPending}
          fetching={files.isPlaceholderData}
          empty={
            files.isError ? (
              <EmptyState title="Couldn’t load files">{errorMessage(files.error)}</EmptyState>
            ) : (
              <EmptyState title={q || category || collection ? 'Nothing here' : 'No files yet'}>
                {q || category || collection ? 'Try another category or search.' : 'Upload brand assets and resources, or ask the client for them with a request.'}
              </EmptyState>
            )
          }
          footer={
            files.data &&
            files.data.total > 0 && (
              <Pagination {...files.data} noun="files" onPage={setPage} onPageSize={(s) => {
                setPageSize(s)
                setPage(1)
              }} />
            )
          }
        />
      </div>

      {editingCollection && (
        <CollectionDialog
          clientId={client._id}
          collection={editingCollection === 'new' ? null : editingCollection}
          onClose={() => setEditingCollection(null)}
          onSaved={refresh}
        />
      )}
      {removingCollection && (
        <ConfirmDialog
          title={`Delete ${removingCollection.name}?`}
          confirm="Delete collection"
          variant="danger"
          action={() => libraryApi.removeCollection(client._id, removingCollection._id)}
          onClose={() => setRemovingCollection(null)}
          onDone={() => {
            if (collection === removingCollection._id) setCollection('')
            refresh()
          }}
        >
          <p>Its files stay in the library; they just leave the collection.</p>
        </ConfirmDialog>
      )}
      {filing && <FileDialog clientId={client._id} file={filing} collections={overview.data?.collections ?? []} onClose={() => setFiling(null)} onSaved={refresh} />}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          confirm="Delete file"
          variant="danger"
          action={() => libraryApi.remove(removing.id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            toast(`${removing.name} deleted`)
            refresh()
          }}
        >
          <p>It disappears from the library for your team and the client.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/** Uploads one or more files into the category being viewed, one after another. */
function UploadButton({ clientId, category, onUploaded }: { clientId: string; category: FileCategory; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const { state, upload } = useUpload()
  const [queue, setQueue] = useState<{ done: number; total: number } | null>(null)

  const run = async (files: File[]) => {
    let ok = 0
    for (const [i, file] of files.entries()) {
      setQueue({ done: i, total: files.length })
      if (await upload(file, { purpose: 'library', client: clientId, category })) ok++
    }
    setQueue(null)
    if (ok) {
      toast(`${ok} file${ok === 1 ? '' : 's'} uploaded to ${categoryLabel[category]}`)
      onUploaded()
    }
  }

  return (
    <div className="flex items-center gap-3">
      {queue && state.phase === 'uploading' && (
        <span className="text-xs text-text-3">
          {queue.total > 1 ? `${queue.done + 1} of ${queue.total} · ` : ''}
          {Math.round(state.progress * 100)}%
        </span>
      )}
      {!queue && state.phase === 'failed' && <span className="max-w-64 truncate text-xs text-negative">{state.message}</span>}
      <Button variant="primary" loading={!!queue} onClick={() => input.current?.click()}>
        <Upload size={15} /> Upload
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void run(files)
        }}
      />
    </div>
  )
}

function CollectionDialog({ clientId, collection, onClose, onSaved }: { clientId: string; collection: Collection | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [visibility, setVisibility] = useState<'internal' | 'client'>(collection?.visibility ?? 'client')
  const m = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim(), visibility }
      return collection ? libraryApi.updateCollection(clientId, collection._id, body) : libraryApi.createCollection(clientId, body)
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  return (
    <Dialog
      title={collection ? 'Edit collection' : 'New collection'}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="col-name" error={errors.name}>
          <Input id="col-name" autoFocus maxLength={120} placeholder="e.g. Diwali shoot" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)" htmlFor="col-desc">
          <Textarea id="col-desc" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Who sees it" htmlFor="col-vis" hint="A team-only collection stays hidden from the client, even if a file in it is shared.">
          <Select id="col-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as 'internal' | 'client')}>
            <option value="client">Your team and the client</option>
            <option value="internal">Your team only</option>
          </Select>
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}

function FileDialog({ clientId, file, collections, onClose, onSaved }: { clientId: string; file: LibraryFile; collections: Collection[]; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<FileCategory>(file.category)
  const [collection, setCollection] = useState(file.collection ?? 'none')
  const m = useMutation({
    mutationFn: () => libraryApi.organise(clientId, file.id, { category, collection: collection === 'none' ? null : collection }),
    onSuccess: () => {
      toast(`${file.name} filed`)
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      title="Category and collection"
      description={file.name}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Category" htmlFor="file-cat">
          <Select id="file-cat" value={category} onChange={(e) => setCategory(e.target.value as FileCategory)}>
            {FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Collection" htmlFor="file-col" hint="A file is in at most one collection.">
          <Select id="file-col" value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="none">No collection</option>
            {collections.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {m.isError && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}
