import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // The API (backend/, `npm run dev` there) on the same origin, so the session cookie just works.
    // API_PROXY points it at another backend, e.g. a second one running against a test database.
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:8787' },
  },
})
