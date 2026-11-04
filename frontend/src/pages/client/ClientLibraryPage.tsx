import { useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileText, FileUp, FolderInput, Image as ImageIcon, LoaderCircle, Trash2, Video } from 'lucide-react'
import { SearchInput } from '@/components/list/SearchInput'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Select } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import { assetCategoryLabel } from '@/features/brand/labels'
import { clientLibraryApi, clientLibraryKey } from '@/features/client-app/library/api'
import { useClientSpace } from '@/features/client-app/space'
import { FILE_CATEGORIES, type FileCategory, type LibraryFile } from '@/features/library/api'
import { useListState } from '@/hooks/useListState'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'

const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const iconFor = (mime: string) => (mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Video : FileText)

/**
 * F64/F65 resource library: everything shared between the brand and the agency, by category and collection.
 * Request uploads land here too (D36). People who can upload add files and file their own uploads.
 */
export function ClientLibraryPage() {
  const s = useClientSession()
  const space = useClientSpace()
  const state = useListState()
  const qc = useQueryClient()
  const category = state.get('category') as FileCategory | ''
  const collection = state.get('collection')
  const [uploadCategory, setUploadCategory] = useState<FileCategory>('brand')
  const [organising, setOrganising] = useState<LibraryFile | null>(null)
  const [removing, setRemoving] = useState<LibraryFile | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { state: upload, upload: send } = useUpload()

  const overview = useQuery({ queryKey: [...clientLibraryKey, 'overview'], queryFn: clientLibraryApi.overview })
  const query = new URLSearchParams({ pageSize: '50', ...(category ? { category } : {}), ...(collection ? { collection } : {}), ...(state.get('q') ? { q: state.get('q') } : {}) }).toString()
  const files = useQuery({ queryKey: [...clientLibraryKey, 'files', query], queryFn: () => clientLibraryApi.files(query), placeholderData: keepPreviousData })
  const canUpload = !!space.data?.can.upload
  const busy = upload.phase === 'uploading' || upload.phase === 'processing'
  const refresh = () => void qc.invalidateQueries({ queryKey: clientLibraryKey })

  const remove = useMutation({
    mutationFn: (f: LibraryFile) => clientLibraryApi.remove(f.id),
    onSuccess: () => {
      toast('File deleted')
      refresh()
    },
  })

  const pick = async (list: FileList | null) => {
    for (const file of [...(list ?? [])]) {
      const done = await send(file, { purpose: 'library', category: uploadCategory })
      if (!done) break
    }
    refresh()
  }
  const open = (f: LibraryFile, download: boolean) =>
    void clientLibraryApi.download(f.id, !download).then(
      ({ url }) => window.open(url, '_blank', 'noopener'),
      (err) => toast(errorMessage(err), 'error'),
    )

  const counts = overview.data?.categories
  const chip = (active: boolean) => cn('h-9 shrink-0 rounded-full px-3.5 text-[13px] whitespace-nowrap', active ? 'bg-brand font-medium text-white' : 'bg-white text-text-2 ring-1 ring-border-strong hover:bg-surface')

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[32px] leading-tight text-brand">Library</h1>
        <p className="mt-1 text-[14px] text-text-2">Brand files, photos and everything you’ve shared with your agency.</p>
      </header>

      {canUpload && (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Upload into" htmlFor="upload-category" className="min-w-40 flex-1">
              <Select id="upload-category" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value as FileCategory)}>
                {FILE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {assetCategoryLabel[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" className="h-11 px-5" loading={busy} onClick={() => input.current?.click()}>
              <FileUp size={16} /> Upload files
            </Button>
          </div>
          {upload.phase === 'uploading' && <p className="text-xs text-text-3">Uploading {upload.name}… {Math.round(upload.progress * 100)}%</p>}
          {upload.phase === 'failed' && <p className="text-xs text-negative">{upload.message}</p>}
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files)
              e.target.value = ''
            }}
          />
        </section>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
        <button type="button" role="tab" aria-selected={!category && !collection} className={chip(!category && !collection)} onClick={() => state.update({ category: null, collection: null })}>
          All
        </button>
        {FILE_CATEGORIES.filter((c) => (counts?.[c] ?? 0) > 0 || c === category).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={category === c} className={chip(category === c)} onClick={() => state.update({ category: c, collection: null })}>
            {assetCategoryLabel[c]} <span className="opacity-70">{counts?.[c] ?? 0}</span>
          </button>
        ))}
      </div>

      {(overview.data?.collections.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">Collections</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {overview.data!.collections.map((c) => (
              <button key={c._id} type="button" className={chip(collection === c._id)} onClick={() => state.update({ collection: collection === c._id ? null : c._id, category: null })}>
                {c.name} <span className="opacity-70">{c.fileCount}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <SearchInput value={state.get('q')} onChange={(q) => state.update({ q })} placeholder="Search file names…" />

      {files.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : files.isError ? (
        <EmptyState title="Couldn’t load the library">{errorMessage(files.error)}</EmptyState>
      ) : files.data.items.length === 0 ? (
        <EmptyState title="Nothing here yet">{canUpload ? 'Upload logos, fonts, photos or anything your agency should have.' : 'Files you and your agency share show up here.'}</EmptyState>
      ) : (
        <ul className={cn('flex flex-col divide-y divide-border rounded-2xl border border-border bg-white transition-opacity', files.isPlaceholderData && 'opacity-60')}>
          {files.data.items.map((f) => {
            const Icon = iconFor(f.mimeType)
            const mine = f.uploadedBy?.side === 'client' && f.uploadedBy.id === s.user.id
            return (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-input text-text-3">
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{f.name}</span>
                  <span className="block truncate text-xs text-text-3">
                    {assetCategoryLabel[f.category]} · {sizeLabel(f.size)} · {f.uploadedBy?.side === 'agency' ? 'from your agency' : (f.uploadedBy?.name ?? '')} · {formatDate(f.createdAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <button type="button" aria-label={`View ${f.name}`} onClick={() => open(f, false)} className="grid size-10 place-items-center rounded-lg text-text-2 hover:bg-black/5">
                    <Eye size={17} />
                  </button>
                  <button type="button" aria-label={`Download ${f.name}`} onClick={() => open(f, true)} className="grid size-10 place-items-center rounded-lg text-text-2 hover:bg-black/5">
                    <Download size={17} />
                  </button>
                  {mine && canUpload && (
                    <>
                      <button type="button" aria-label={`File ${f.name}`} onClick={() => setOrganising(f)} className="grid size-10 place-items-center rounded-lg text-text-2 hover:bg-black/5">
                        <FolderInput size={17} />
                      </button>
                      <button type="button" aria-label={`Delete ${f.name}`} onClick={() => setRemoving(f)} className="grid size-10 place-items-center rounded-lg text-text-2 hover:bg-black/5">
                        <Trash2 size={17} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {organising && <OrganiseDialog file={organising} collections={overview.data?.collections ?? []} onClose={() => setOrganising(null)} onSaved={refresh} />}
      {removing && (
        <ConfirmDialog title={`Delete ${removing.name}?`} confirm="Delete" variant="danger" action={() => remove.mutateAsync(removing)} onClose={() => setRemoving(null)}>
          <p>It’s removed from the library for you and your agency.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/** Clients file their own uploads into a category and a client-visible collection. */
function OrganiseDialog({ file, collections, onClose, onSaved }: { file: LibraryFile; collections: { _id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<FileCategory>(file.category)
  const [collection, setCollection] = useState('')
  const save = useMutation({
    mutationFn: () => clientLibraryApi.organise(file.id, { category, ...(collection ? { collection: collection === 'none' ? null : collection } : {}) }),
    onSuccess: () => {
      toast('Saved')
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      title="File it"
      description={file.name}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Category" htmlFor="org-category">
          <Select id="org-category" value={category} onChange={(e) => setCategory(e.target.value as FileCategory)}>
            {FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {assetCategoryLabel[c]}
              </option>
            ))}
          </Select>
        </Field>
        {collections.length > 0 && (
          <Field label="Collection" htmlFor="org-collection" hint="Leave as is to keep it where it is.">
            <Select id="org-collection" value={collection} onChange={(e) => setCollection(e.target.value)}>
              <option value="">Keep as is</option>
              <option value="none">No collection</option>
              {collections.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {save.isError && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  )
}
