import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { clientsApi } from '@/features/clients/api'
import { reportsApi, type Report } from '@/features/reports/api'
import { CreateReportDialog } from '@/features/reports/CreateReportDialog'
import { ReportStatusPill } from '@/features/reports/pills'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'

/** P126–P129: report drafts and the reports shared with clients. */
export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const client = params.get('client') ?? ''
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const reports = useQuery({ queryKey: ['agency', 'reports', 'list', client], queryFn: () => reportsApi.list(client || undefined) })
  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)?.brandName ?? ''

  const columns: Column<Report>[] = [
    {
      key: 'title',
      header: 'Report',
      className: 'w-[38%]',
      cell: (r) => (
        <CellText
          primary={
            <Link to={`/app/reports/${r._id}`} className="hover:underline">
              {r.title}
            </Link>
          }
          secondary={brand(r.client)}
        />
      ),
    },
    { key: 'period', header: 'Period', cell: (r) => <span className="text-text-2">{`${formatDate(r.period.from)} – ${formatDate(r.period.to)}`}</span> },
    { key: 'status', header: 'Status', cell: (r) => <ReportStatusPill status={r.status} /> },
    {
      key: 'when',
      header: 'Updated',
      cell: (r) => (
        <CellText
          primary={<span className="font-normal">{r.status === 'shared' ? `Shared ${timeAgo(r.sharedAt)}` : `Numbers from ${timeAgo(r.generatedAt)}`}</span>}
          secondary={r.status === 'shared' ? r.sharedBy?.name : r.createdBy?.name}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Reports"
        back={{ to: '/app/analytics', label: 'Analytics' }}
        description="Frozen snapshots of a period’s numbers. Drafts stay with your team until you share them."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New report
          </Button>
        }
      />
      <Select
        aria-label="Client"
        value={client}
        onChange={(e) => setParams(e.target.value ? { client: e.target.value } : {}, { replace: true })}
        className="mb-4 w-full sm:w-64"
      >
        <option value="">All clients</option>
        {clients.data?.items.map((c) => (
          <option key={c._id} value={c._id}>
            {c.brandName}
          </option>
        ))}
      </Select>
      <DataTable
        label="Reports"
        columns={columns}
        rows={reports.data?.items}
        rowKey={(r) => r._id}
        loading={reports.isPending}
        onRowClick={(r) => navigate(`/app/reports/${r._id}`)}
        empty={
          reports.isError ? (
            <EmptyState title="Couldn’t load reports">{errorMessage(reports.error)}</EmptyState>
          ) : (
            <EmptyState
              title="No reports yet"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> New report
                </Button>
              }
            >
              Make a monthly report for a client: numbers, top posts, what you delivered and your notes.
            </EmptyState>
          )
        }
      />
      {creating && (
        <CreateReportDialog
          clientId={client || undefined}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'reports'] })
            navigate(`/app/reports/${r._id}`)
          }}
        />
      )}
    </>
  )
}
