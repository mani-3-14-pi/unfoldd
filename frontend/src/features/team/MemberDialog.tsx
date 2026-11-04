import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { TagsInput } from '@/components/ui/TagsInput'
import type { AgencyRole } from '@/features/agency/api'
import { agencyRoleHint, agencyRoleLabel, ASSIGNABLE_ROLES, isAgencyAdmin } from '@/features/agency/roles'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { teamApi, type MemberUpdate, type TeamMember } from './api'

/**
 * Role, publishing permission, job titles, departments and capacity for one team member.
 * Titles and departments are display tags, separate from permissions (D44).
 */
export function MemberDialog({ member, myRole, onClose, onSaved }: { member: TeamMember; myRole: AgencyRole; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(member.role)
  const [canPublish, setCanPublish] = useState(member.canPublish)
  const [titles, setTitles] = useState(member.titles)
  const [departments, setDepartments] = useState(member.departments)
  const [capacity, setCapacity] = useState(String(member.capacity))
  // Only the owner can make someone an admin.
  const roles = ASSIGNABLE_ROLES.filter((r) => r !== 'admin' || myRole === 'owner')

  const save = useMutation({
    mutationFn: () => {
      const body: MemberUpdate = { titles, departments, capacity: Number(capacity) }
      if (role !== member.role && role !== 'owner') body.role = role
      if (!isAgencyAdmin(role)) body.canPublish = canPublish
      return teamApi.update(member.user._id, body)
    },
    onSuccess: () => {
      toast(`${member.user.name} updated`)
      onSaved()
      onClose()
    },
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title={`Edit ${member.user.name}`}
      description={member.user.email}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="member-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Role" htmlFor="member-role" error={errors.role} hint={agencyRoleHint[role]}>
          <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value as AgencyRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {agencyRoleLabel[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between gap-6 rounded-lg border border-border-strong px-3.5 py-3">
          <div>
            <label htmlFor="member-publish" className="text-[13px] font-medium">
              Can publish
            </label>
            <p className="mt-0.5 text-xs text-text-3">
              {isAgencyAdmin(role)
                ? 'Owners and admins can always schedule and publish.'
                : 'Lets them schedule and publish approved content, without making them a manager.'}
            </p>
          </div>
          <Switch id="member-publish" label="Can publish" checked={isAgencyAdmin(role) || canPublish} disabled={isAgencyAdmin(role)} onChange={setCanPublish} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job titles" htmlFor="member-titles" hint="e.g. Designer, Copywriter" error={errors.titles}>
            <TagsInput id="member-titles" value={titles} onChange={setTitles} max={10} placeholder="Add a title" />
          </Field>
          <Field label="Departments" htmlFor="member-departments" hint="Used to group workload" error={errors.departments}>
            <TagsInput id="member-departments" value={departments} onChange={setDepartments} max={10} placeholder="Add a department" />
          </Field>
        </div>
        <Field label="Capacity" htmlFor="member-capacity" hint="Most active tasks this person should hold at once." error={errors.capacity} className="sm:w-1/2">
          <Input id="member-capacity" type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-invalid={!!errors.capacity} />
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </form>
    </Dialog>
  )
}
