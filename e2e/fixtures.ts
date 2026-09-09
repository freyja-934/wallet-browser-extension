import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    const extensionId = new URL(worker.url()).hostname;
    await use(extensionId);
  },
});

export const expect = test.expect;
