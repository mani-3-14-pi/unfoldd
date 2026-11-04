import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { ContentFormDialog } from '@/features/content/ContentFormDialog'
import { ContentList } from '@/features/content/ContentList'

/** P42: every piece of content across the clients this person can see. */
export function ContentPage() {
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <>
      <PageHeader
        title="Content"
        description="Every post, reel and carousel in the works, from first draft to published."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New content
          </Button>
        }
      />
      <ContentList />
      {creating && (
        <ContentFormDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'content'] })
            navigate(`/app/content/${id}`)
          }}
        />
      )}
    </>
  )
}
