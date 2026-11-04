import { useCallback, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'

export type UploadPurpose = 'library' | 'logo' | 'request' | 'version' | 'attachment'

export interface UploadedFile {
  id: string
  client: string | null
  purpose: UploadPurpose
  name: string
  mimeType: string
  size: number
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  error?: string
  createdAt: string
}

/** F87/P167 upload states. */
export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; name: string; progress: number }
  | { phase: 'processing'; name: string }
  | { phase: 'done'; file: UploadedFile }
  | { phase: 'failed'; name: string; message: string }

interface CreateResponse {
  file: UploadedFile
  upload: { url: string; method: 'PUT'; headers: Record<string, string> }
}

/** PUT straight to storage with progress. fetch() can't report upload progress, so this uses XHR. */
function put(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload was rejected. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

/**
 * One file at a time, the way the backend wants it (rule §12.6): create the file record, PUT the bytes to the
 * presigned URL, then `complete` so the server checks the object really arrived.
 */
export function useUpload() {
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const abort = useRef<AbortController | null>(null)

  const upload = useCallback(
    async (file: File, options: { purpose: UploadPurpose; client?: string; category?: string }): Promise<UploadedFile | null> => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setState({ phase: 'uploading', name: file.name, progress: 0 })
      try {
        const created = await api<CreateResponse>('/files', {
          body: { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, ...options },
          idempotencyKey: crypto.randomUUID(),
        })
        await put(created.upload.url, file, created.upload.headers, (progress) => setState({ phase: 'uploading', name: file.name, progress }), controller.signal)
        setState({ phase: 'processing', name: file.name })
        const { file: done } = await api<{ file: UploadedFile }>(`/files/${created.file.id}/complete`, { method: 'POST' })
        if (done.status === 'failed') throw new Error(done.error ?? 'The upload failed. Try again.')
        setState({ phase: 'done', file: done })
        return done
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setState({ phase: 'idle' })
          return null
        }
        const message =
          err instanceof ApiError && err.status === 503
            ? 'File uploads aren’t set up on this server yet.'
            : err instanceof Error
              ? err.message
              : 'The upload failed. Try again.'
        setState({ phase: 'failed', name: file.name, message })
        return null
      }
    },
    [],
  )

  const cancel = useCallback(() => abort.current?.abort(), [])
  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, upload, cancel, reset }
}
