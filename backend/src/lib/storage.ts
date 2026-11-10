import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.ts'
import { AppError } from '../utils/AppError.ts'

/*
 * Cloudflare R2 through its S3 API (rule §12.6). Browsers upload straight to the bucket with a presigned PUT
 * and download with a short-lived presigned GET; file bytes never pass through this server.
 *
 * Bucket setup: keep the bucket private, and add a CORS rule allowing PUT and GET from APP_URL with the
 * Content-Type header. Never serve the bucket from the app's own domain: uploaded HTML/SVG must stay on a
 * separate origin (see `isActiveContent`).
 */

const UPLOAD_URL_TTL_S = 15 * 60
const DOWNLOAD_URL_TTL_S = 5 * 60

let client: S3Client | null = null

export const storageConfigured = () => !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET)

function s3() {
  if (!storageConfigured()) throw new AppError(503, 'storage_unavailable', 'File storage isn’t set up yet.')
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    // Otherwise the SDK signs a CRC32 of the empty body into presigned PUTs, and R2 rejects the real upload.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return client
}

/** Types a browser would run if opened directly. Always downloaded as an attachment, never shown inline. */
export const isActiveContent = (mimeType: string, name: string) =>
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)$/i.test(mimeType) || /\.(html?|xhtml|svg|xml)$/i.test(name)

export const presignUpload = (key: string, mimeType: string, size: number) =>
  getSignedUrl(s3(), new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: mimeType, ContentLength: size }), {
    expiresIn: UPLOAD_URL_TTL_S,
  })

export async function presignDownload(key: string, file: { name: string; mimeType: string }, opts: { inline?: boolean; expiresInS?: number } = {}) {
  const inline = opts.inline && !isActiveContent(file.mimeType, file.name)
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
  const url = await getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      ResponseContentDisposition: disposition,
      // HTML/SVG is served as plain bytes so it can't run even if someone opens the URL.
      ResponseContentType: isActiveContent(file.mimeType, file.name) ? 'application/octet-stream' : file.mimeType,
    }),
    { expiresIn: opts.expiresInS ?? DOWNLOAD_URL_TTL_S },
  )
  return { url, expiresAt: new Date(Date.now() + (opts.expiresInS ?? DOWNLOAD_URL_TTL_S) * 1000) }
}

/** The stored object's size, or null if nothing was uploaded. */
export async function headObject(key: string) {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
    return { size: head.ContentLength ?? 0, contentType: head.ContentType }
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null
    throw err
  }
}

export const deleteObject = (key: string) => s3().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
