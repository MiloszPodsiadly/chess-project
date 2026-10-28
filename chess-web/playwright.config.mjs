import { defineConfig } from '@playwright/test';

const baseURL = process.env.MULTIPLAYER_BASE_URL || 'http://localhost:4200';
const useLocalFrontend = !process.env.MULTIPLAYER_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/multiplayer.spec.mjs',
  outputDir: './test-results/multiplayer',
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: './playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: useLocalFrontend
    ? {
        command: 'npm run start -- --host localhost --port 4200',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
    : undefined
});
