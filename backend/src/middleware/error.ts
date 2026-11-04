import type { ErrorRequestHandler, RequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError, z } from 'zod'
import { isProd } from '../config/env.ts'
import { AppError, notFound } from '../utils/AppError.ts'

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('No such endpoint.'))

// Express 5 forwards rejected promises from async handlers here, so routes can just `throw`.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let error: AppError
  if (err instanceof AppError) error = err
  else if (err instanceof ZodError) error = new AppError(400, 'invalid_input', 'Some fields are invalid.', z.flattenError(err).fieldErrors)
  else if (err instanceof mongoose.Error.CastError) error = notFound()
  else {
    console.error(err)
    error = new AppError(500, 'internal', isProd ? 'Something went wrong.' : String(err?.message ?? err))
  }
  res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } })
}
