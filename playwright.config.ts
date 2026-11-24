import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3107'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('Defina TEST_DATABASE_URL para um banco descartável antes de rodar o Playwright.')

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'node dist/server/main.js --serve-web',
    env: {
      PORT: '3107',
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATION_URL: '',
      TEST_DATABASE_MIGRATION_URL: '',
    },
    url: baseURL,
    reuseExistingServer: false,
  },
})
