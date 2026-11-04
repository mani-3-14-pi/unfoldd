/** An error the API returns to the client as `{ error: { code, message, details } }`. */
export class AppError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Not found and not allowed both return 404, so a client can't probe for other tenants' ids. */
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message)

/** For things the person can already see but their role can't change (e.g. a Member editing agency settings). */
export const forbidden = (message = 'You don’t have permission to do that.') => new AppError(403, 'forbidden', message)

export const invalid = (field: string, message: string) =>
  new AppError(400, 'invalid_input', 'Some fields are invalid.', { [field]: [message] })
