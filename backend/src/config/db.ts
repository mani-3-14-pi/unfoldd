import mongoose from 'mongoose'
import { env } from './env.ts'

export async function connectDb() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`)
}

export async function disconnectDb() {
  await mongoose.disconnect()
}
