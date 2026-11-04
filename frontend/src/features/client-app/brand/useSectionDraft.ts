import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Brand } from '@/features/brand/api'
import { clientBrandApi, clientBrandKey, type ClientEditableSection } from './api'

/**
 * One Brand DNA section being edited: local data plus the `rev` it was loaded at. `save()` sends it and keeps
 * the new `rev`, so the wizard can save on every "Next" (saves as you go). A stale save answers 409 with who
 * changed it; `reload()` drops local edits and takes theirs (D41).
 */
export function useSectionDraft<T extends object>(brand: Brand, section: ClientEditableSection, empty: T, clean: (data: T) => T = (d) => d) {
  const qc = useQueryClient()
  const stored = brand.sections[section]
  const [data, setData] = useState<T>(() => ({ ...empty, ...(stored.data as Partial<T>) }))
  const [rev, setRev] = useState(stored.rev)
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    // `clean` drops half-filled rows the server would refuse (e.g. an offering without a name).
    mutationFn: () => clientBrandApi.saveSection(section, rev, clean(data)),
    onSuccess: ({ section: saved }) => {
      setRev(saved.rev)
      setDirty(false)
      qc.setQueryData<{ brand: Brand }>(clientBrandKey, (old) => (old ? { brand: { ...old.brand, sections: { ...old.brand.sections, [section]: saved } } } : old))
    },
  })

  const update = (patch: Partial<T>) => {
    setData((d) => ({ ...d, ...patch }))
    setDirty(true)
    if (save.isError) save.reset()
  }

  const reload = async () => {
    const fresh = await qc.fetchQuery({ queryKey: clientBrandKey, queryFn: clientBrandApi.get, staleTime: 0 })
    const s = fresh.brand.sections[section]
    setData({ ...empty, ...(s.data as Partial<T>) })
    setRev(s.rev)
    setDirty(false)
    save.reset()
  }

  /** Saves only when something changed; resolves once stored (or straight away). */
  const saveIfDirty = async () => {
    if (dirty) await save.mutateAsync()
  }

  return { data, update, dirty, save, saveIfDirty, reload }
}
