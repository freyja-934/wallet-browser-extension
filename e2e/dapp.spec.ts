import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { importAndUnlock, TEST_PASSWORD } from './popup';

async function openApproval(
  context: BrowserContext,
  action: () => Promise<void>,
  dapp?: Page,
): Promise<Page> {
  const seen = new Set(context.pages());
  await action();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (page.url().includes('approve.html')) {
        await expect(page.getByTestId('approval-approve')).toBeEnabled({ timeout: 15_000 });
        return page;
      }
    }
    for (const page of context.pages()) {
      if (seen.has(page)) continue;
      try {
        await page.waitForURL(/approve\.html/, { timeout: 500 });
        await expect(page.getByTestId('approval-approve')).toBeEnabled({ timeout: 15_000 });
        return page;
      } catch {
        /* still loading */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const log = dapp ? await dapp.locator('#log').innerText() : '';
  throw new Error(`no approve.html among ${context.pages().map((page) => page.url()).join(', ')}; dapp=${log}`);
}

async function approveNext(context: BrowserContext, action: () => Promise<void>, dapp?: Page) {
  const approval = await openApproval(context, action, dapp);
  await approval.getByTestId('approval-approve').click();
}

test('Connect, sign message, and sign v0 transfer', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#signMessage').click(), dapp);
  await expect(dapp.locator('#log')).toContainText('signature', { timeout: 15_000 });

  const signTx = await openApproval(context, () => dapp.locator('#signTx').click(), dapp);
  const preview = signTx.getByTestId('approval-preview');
  if (await preview.isVisible().catch(() => false)) {
    await expect(preview).toContainText(/Simulation|failed|succeeded/i);
  }
  await signTx.getByTestId('approval-approve').click();
  await expect(dapp.locator('#log')).toContainText('signedBytes', { timeout: 30_000 });
});

test('locked Connect opens Unlock, then signAndSend can be rejected', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await popup.getByLabel('Lock wallet').click();
  await expect(popup.getByTestId('unlock-password')).toBeVisible();

  await dapp.locator('#connect').click();
  const unlock = await waitForUnlock(context);
  await unlock.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await unlock.getByTestId('unlock-submit').click();
  await expect(unlock.getByTestId('open-receive').or(popup.getByTestId('open-receive'))).toBeVisible({
    timeout: 15_000,
  });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  const sendApproval = await openApproval(context, () => dapp.locator('#signAndSend').click(), dapp);
  await sendApproval.getByTestId('approval-reject').click();
  await expect(dapp.locator('#log')).toContainText(/reject|denied|User rejected/i, { timeout: 15_000 });
  await expect(dapp.locator('#log')).not.toContainText('"signature"');
});

test('signAndSend approve broadcasts a 0-lamport self-transfer', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#signAndSend').click(), dapp);
  await expect(dapp.locator('#log')).toContainText('"signature"', { timeout: 45_000 });
  await expect(dapp.locator('#log')).not.toContainText(/reject|denied|User rejected/i);
});

async function waitForUnlock(context: BrowserContext): Promise<Page> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (!page.url().includes('index.html')) continue;
      const field = page.getByTestId('unlock-password');
      if (await field.isVisible().catch(() => false)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no unlock among ${context.pages().map((page) => page.url()).join(', ')}`);
}

/** Post a raw bridge message from the page and wait for the content script's reply. */
async function postToBridge(
  dapp: Page,
  message: Record<string, unknown>,
): Promise<{ response?: Record<string, unknown>; error?: string }> {
  return dapp.evaluate(
    (msg) =>
      new Promise<{ response?: Record<string, unknown>; error?: string }>((resolve) => {
        const id = Math.floor(Math.random() * 1e9);
        window.addEventListener('message', (event) => {
          if (event.source !== window || event.data?.channel !== 'cinder-wallet' || event.data.id !== id) return;
          if (event.data.response === undefined && event.data.error === undefined) return;
          resolve({ response: event.data.response, error: event.data.error });
        });
        window.postMessage({ channel: 'cinder-wallet', id, ...msg }, '*');
      }),
    message,
  );
}

test('a page cannot override the bridged message type', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  // The old bridge spread the payload after `type`, so `payload.type` overrode the
  // allow-listed outer type and the worker answered GET_STATE with wallet state.
  const smuggled = await postToBridge(dapp, { type: 'GET_ACCOUNTS', payload: { type: 'GET_STATE' } });
  expect(smuggled.error).toBeUndefined();
  expect(smuggled.response?.state).toBeUndefined();
  expect(Array.isArray(smuggled.response?.accounts)).toBe(true);

  // Popup-only types and malformed payloads are refused before anything reaches the worker.
  const direct = await postToBridge(dapp, { type: 'EXPORT_SEED', payload: { password: 'guess' } });
  expect(direct.error).toBe('Unknown message type');
  const oversize = await postToBridge(dapp, {
    type: 'SIGN_MESSAGE',
    payload: { message: new Array(64 * 1024 + 1).fill(0) },
  });
  expect(oversize.error).toBe('Invalid message');
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});
