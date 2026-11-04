import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil } from 'lucide-react'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { TagsInput } from '@/components/ui/TagsInput'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { brandApi, type Guidelines as GuidelinesData } from './api'

const RULE_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'x'] as const
const platformName = (p: string) => (p === 'x' ? 'X' : p === 'linkedin' ? 'LinkedIn' : p === 'youtube' ? 'YouTube' : p === 'tiktok' ? 'TikTok' : p.charAt(0).toUpperCase() + p.slice(1))

/** P25: the agency's creative rules for this client. Internal: the client never sees them. */
export function Guidelines({ clientId, writable }: { clientId: string; writable: boolean }) {
  const qc = useQueryClient()
  const key = ['agency', 'brand', clientId, 'guidelines']
  const query = useQuery({ queryKey: key, queryFn: () => brandApi.guidelines(clientId) })
  const [editing, setEditing] = useState(false)

  const g = query.data?.guidelines
  const rules = Object.entries(g?.platformRules ?? {}).filter(([, v]) => v)
  return (
    <Card
      title="Creative guidelines"
      description={
        <span className="inline-flex items-center gap-1">
          <Lock size={11} /> Internal: only your team sees these.
        </span>
      }
      action={
        writable &&
        g && (
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </Button>
        )
      }
    >
      {query.isPending ? (
        <div className="h-24" />
      ) : query.isError ? (
        <EmptyState title="Couldn’t load guidelines">{errorMessage(query.error)}</EmptyState>
      ) : (
        <Details
          rows={[
            { label: 'Do', value: g!.dos.length ? g!.dos.map((d) => `• ${d}`).join('\n') : '' },
            { label: 'Don’t', value: g!.donts.length ? g!.donts.map((d) => `• ${d}`).join('\n') : '' },
            { label: 'Tone', value: g!.tone, wide: true },
            { label: 'Visual direction', value: g!.visualDirection, wide: true },
            { label: 'Content rules', value: g!.contentRules, wide: true },
            ...rules.map(([p, v]) => ({ label: platformName(p), value: v })),
          ]}
        />
      )}
      {editing && g && (
        <GuidelinesDialog
          clientId={clientId}
          initial={g}
          onClose={() => setEditing(false)}
          onSaved={() => void qc.invalidateQueries({ queryKey: key })}
        />
      )}
    </Card>
  )
}

function GuidelinesDialog({ clientId, initial, onClose, onSaved }: { clientId: string; initial: GuidelinesData; onClose: () => void; onSaved: () => void }) {
  const [dos, setDos] = useState(initial.dos)
  const [donts, setDonts] = useState(initial.donts)
  const [tone, setTone] = useState(initial.tone)
  const [visualDirection, setVisual] = useState(initial.visualDirection)
  const [contentRules, setRules] = useState(initial.contentRules)
  const [platformRules, setPlatformRules] = useState<Record<string, string>>({ ...initial.platformRules })

  const save = useMutation({
    mutationFn: () => brandApi.saveGuidelines(clientId, { rev: initial.rev, dos, donts, tone, visualDirection, contentRules, platformRules }),
    onSuccess: () => {
      toast('Guidelines saved')
      onSaved()
      onClose()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title="Creative guidelines"
      description="Internal. Your team works from these; the client never sees them."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="guidelines-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="guidelines-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Do" htmlFor="g-dos" hint="Press Enter after each rule.">
            <TagsInput id="g-dos" value={dos} onChange={setDos} max={50} placeholder="e.g. Show the product in hand" />
          </Field>
          <Field label="Don’t" htmlFor="g-donts">
            <TagsInput id="g-donts" value={donts} onChange={setDonts} max={50} placeholder="e.g. No stock photos" />
          </Field>
        </div>
        <Field label="Tone" htmlFor="g-tone">
          <Textarea id="g-tone" maxLength={5000} value={tone} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <Field label="Visual direction" htmlFor="g-visual">
          <Textarea id="g-visual" maxLength={5000} value={visualDirection} onChange={(e) => setVisual(e.target.value)} />
        </Field>
        <Field label="Content rules" htmlFor="g-rules">
          <Textarea id="g-rules" maxLength={5000} value={contentRules} onChange={(e) => setRules(e.target.value)} />
        </Field>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-medium text-text-2">Platform rules</legend>
          {RULE_PLATFORMS.map((p) => (
            <Field key={p} label={platformName(p)} htmlFor={`g-${p}`}>
              <Input id={`g-${p}`} maxLength={2000} placeholder="e.g. Max 3 hashtags" value={platformRules[p] ?? ''} onChange={(e) => setPlatformRules((r) => ({ ...r, [p]: e.target.value }))} />
            </Field>
          ))}
        </fieldset>
        {save.isError && (
          <FormError
            error={save.error}
            onReload={() => {
              onSaved()
              onClose()
            }}
          />
        )}
      </form>
    </Dialog>
  )
}
