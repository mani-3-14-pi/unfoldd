// Fills in schema defaults that older documents are missing. Lean reads and aggregations skip Mongoose defaults,
// so a document saved before a field existed reaches the frontend without it.
//   npm run backfill:defaults               report what's missing (read-only)
//   npm run backfill:defaults -- --apply    also write the defaults
// Only paths absent from a document are set; nothing that exists is changed. Array elements are not touched.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.ts'

const apply = process.argv.includes('--apply')
const modulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules')

for (const entry of await readdir(modulesDir, { recursive: true })) {
  if (entry.endsWith('.model.ts')) await import(pathToFileURL(path.join(modulesDir, entry)).href)
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

/** Paths (dot notation) present in `filled` but absent from `raw`, with the value to set. */
function missing(raw: Record<string, unknown>, filled: Record<string, unknown>, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = []
  for (const [k, v] of Object.entries(filled)) {
    if (k === '_id' || k === '__v' || v === undefined) continue
    if (!(k in raw)) out.push([prefix + k, v])
    else if (isPlain(raw[k]) && isPlain(v)) out.push(...missing(raw[k] as Record<string, unknown>, v, `${prefix}${k}.`))
  }
  return out
}

await connectDb()

let total = 0
for (const name of mongoose.modelNames().sort()) {
  const Model = mongoose.model(name)
  const counts = new Map<string, number>()
  const ops: mongoose.mongo.AnyBulkWriteOperation[] = []
  for await (const raw of Model.collection.find({})) {
    const filled = Model.hydrate(raw).toObject({ depopulate: true, virtuals: false, getters: false })
    const paths = missing(raw, filled)
    if (!paths.length) continue
    for (const [p] of paths) counts.set(p, (counts.get(p) ?? 0) + 1)
    ops.push({ updateOne: { filter: { _id: raw._id }, update: { $set: Object.fromEntries(paths) } } })
  }
  if (!ops.length) continue
  total += ops.length
  console.log(`\n${name} (${Model.collection.name}): ${ops.length} document(s)`)
  for (const [p, n] of [...counts].sort()) console.log(`  ${p}  ×${n}`)
  if (apply) {
    for (let i = 0; i < ops.length; i += 500) await Model.collection.bulkWrite(ops.slice(i, i + 500), { ordered: false })
    console.log('  → updated')
  }
}

console.log(total ? `\n${total} document(s) ${apply ? 'updated' : 'need defaults; run again with --apply to write them'}.` : '\nEvery document already has its defaults.')
await disconnectDb()
