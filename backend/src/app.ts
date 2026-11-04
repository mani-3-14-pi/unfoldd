import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { env, isProd, isTest } from './config/env.ts'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { apiRouter } from './routes.ts'

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  if (!isTest) app.use(morgan(isProd ? 'combined' : 'dev'))

  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
