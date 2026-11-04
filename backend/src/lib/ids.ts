import { isValidObjectId, Types } from 'mongoose'
import { notFound } from '../utils/AppError.ts'

/** Parses a route id; a malformed id is just another thing that doesn't exist. */
export const objectId = (id: unknown, message?: string) => {
  if (typeof id !== 'string' || !isValidObjectId(id)) throw notFound(message)
  return new Types.ObjectId(id)
}
