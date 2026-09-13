import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext } from '@playwright/test';

/**
 * The build under test. `just e2e` builds with the same variable, so
 * `CINDER_OUT_DIR=dist-store just e2e` drives the store build instead of the
 * devnet one. `||`, not `??`: an empty value must not point at the repo root.
 */
export const outDir = process.env.CINDER_OUT_DIR || 'dist';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', outDir);

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
