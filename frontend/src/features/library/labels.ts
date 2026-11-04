import type { FileCategory } from './api'

export const categoryLabel: Record<FileCategory, string> = {
  brand: 'Brand',
  photography: 'Photography',
  video: 'Video',
  documents: 'Documents',
  fonts: 'Fonts',
  product: 'Product',
  existing_creatives: 'Existing creatives',
  other: 'Other',
}

/** "2.4 MB" */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
