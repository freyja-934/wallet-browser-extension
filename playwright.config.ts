import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'pnpm exec vite --config vite.dapp.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
  },
});
