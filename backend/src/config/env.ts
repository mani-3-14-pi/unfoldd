import { z } from 'zod'

const optional = z
  .string()
  .optional()
  .transform((s) => s || undefined)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  MONGODB_URI: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Where the frontend lives; used to build links in emails (invites, notifications). */
  APP_URL: z.string().default('http://localhost:5173'),
  /** This API's public address; OAuth providers redirect back to it. */
  API_URL: z.string().default('http://localhost:8787'),
  /** Encrypts 2FA seeds and platform tokens at rest. Required in production (any long random string). */
  SECRET_KEY: optional,
  /**
   * 2FA for platform admins and agency owners. Off for now while the product is being built: logins open a
   * session straight away. Turn it on (MFA_REQUIRED=true) before going live.
   */
  MFA_REQUIRED: z.stringbool().default(false),
  /** Turns off the in-process job worker, e.g. on API-only instances when a separate worker runs. */
  JOBS_DISABLED: z.stringbool().default(false),

  // Email. Without RESEND_API_KEY the dev mailer only logs and stores messages.
  EMAIL_FROM: z.string().default('Unfoldd <no-reply@unfoldd.app>'),
  RESEND_API_KEY: optional,
  /** Where support tickets are emailed (D67 "Report issue"). */
  SUPPORT_EMAIL: optional,

  // Cloudflare R2 (S3 API). File routes answer 503 until all four are set.
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,

  // AI revision checklist (D21). Off until a key is set; AI_PROVIDER=none switches it off explicitly.
  AI_PROVIDER: z.enum(['anthropic', 'none']).optional(),
  ANTHROPIC_API_KEY: optional,
  /** Claude Haiku is the cheapest model that does this well; any Claude model ID works here. */
  AI_MODEL: z.string().default('claude-haiku-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),

  // Publishing integrations (D66). A platform stays "manual only" until its app credentials are set.
  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_GRAPH_VERSION: z.string().default('v23.0'),
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  /** LinkedIn's versioned REST API, `YYYYMM`. */
  LINKEDIN_API_VERSION: z.string().default('202510'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,

  /** Largest upload accepted, in MB. */
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(500),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
