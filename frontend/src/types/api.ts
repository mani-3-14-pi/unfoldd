/** One page of a list, as every paginated endpoint answers (backend `lib/pagination.ts`). */
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Who changed something last; sent with `rev`-guarded records. */
export interface UpdatedBy {
  id: string
  name: string
}
