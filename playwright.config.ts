import { defineConfig, devices } from '@playwright/test'

const APP_PORT = 54332
const API_PORT = 54331

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /voting\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /voting-touch\.spec\.ts/ },
  ],
  // Points the app at the throwaway local stack, never at the hosted project.
  webServer: {
    command: `npx vite --port ${APP_PORT} --strictPort --mode e2e`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: `http://localhost:${API_PORT}`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
      VITE_ENV: '',
    },
  },
})
