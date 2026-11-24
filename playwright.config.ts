import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3107'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm start',
    env: { PORT: '3107' },
    url: baseURL,
    reuseExistingServer: false,
  },
})
