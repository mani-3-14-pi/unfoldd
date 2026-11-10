import { defineConfig, devices } from '@playwright/test'

// Override with E2E_API_PORT / E2E_WEB_PORT / E2E_CLIENT_PORT to run two suites side by side.
const API_PORT = process.env.E2E_API_PORT ?? '8790'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5175'
/** The simple client app (client/). Client invite links open here in the tests. */
export const CLIENT_APP_PORT = process.env.E2E_CLIENT_PORT ?? '5177'

/**
 * End-to-end tests: the real frontend against the real backend on a throwaway in-memory database.
 * Run with `npm run test:e2e` from the repo root. Ports 8790/5175 stay clear of `npm run dev` (8787/5173).
 */
export default defineConfig({
  testDir: './tests',
  // One folder per API port, so side-by-side runs don't wipe each other's results.
  outputDir: `test-results/${API_PORT}`,
  // Each test signs up its own agency, so tests can run side by side.
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/server.mjs',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { E2E_API_PORT: API_PORT, E2E_WEB_PORT: WEB_PORT, E2E_CLIENT_PORT: CLIENT_APP_PORT },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: '../frontend',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY: `http://localhost:${API_PORT}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${CLIENT_APP_PORT} --strictPort`,
      cwd: '../client',
      url: `http://localhost:${CLIENT_APP_PORT}`,
      env: { API_PROXY: `http://localhost:${API_PORT}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
})
