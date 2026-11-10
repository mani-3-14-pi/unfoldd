import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Simple client portal. Runs on 5176 and proxies /api to the backend so the session cookie is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:8787' },
  },
})
