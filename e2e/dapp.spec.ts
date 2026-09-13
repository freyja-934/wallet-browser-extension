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
  // The devnet build's account advertises the devnet chain, so wallet-adapter will let it send.
  await expect(dapp.locator('#log')).toContainText('solana:devnet');

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

test('locked Connect unlocks inside the approval window, then signAndSend can be rejected', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await popup.getByLabel('Lock wallet').click();
  await expect(popup.getByTestId('unlock-password')).toBeVisible();

  // No separate index.html window any more: approve.html carries the unlock form.
  await dapp.locator('#connect').click();
  const approval = await waitForUnlock(context);
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await approval.getByTestId('unlock-submit').click();
  await expect(approval.getByTestId('approval-approve')).toBeEnabled({ timeout: 15_000 });
  await approval.getByTestId('approval-approve').click();
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
  expect(context.pages().filter((page) => page.url().includes('index.html'))).toHaveLength(1);

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

  // The simulated balance change of a 0-lamport self-transfer is exactly the fee, named as such.
  const sendApproval = await openApproval(context, () => dapp.locator('#signAndSend').click(), dapp);
  await expect(sendApproval.getByTestId('approval-preview')).toHaveText('Simulation succeeded');
  const solRow = sendApproval.getByTestId('balance-diff-sol');
  await expect(solRow).toBeVisible();
  await expect(solRow).toHaveAttribute('data-sign', 'negative');
  await expect(sendApproval.getByTestId('balance-diff-sol-delta')).toHaveText('-0.000005 SOL');
  await expect(solRow).toContainText('network fee');
  await expect(sendApproval.getByTestId('approval-approve')).toHaveText('Approve');
  await sendApproval.getByTestId('approval-approve').click();
  await expect(dapp.locator('#log')).toContainText('"signature"', { timeout: 45_000 });
  await expect(dapp.locator('#log')).not.toContainText(/reject|denied|User rejected/i);
  // 64 raw bytes (not the digits of a base58 string) and a signature the cluster confirms.
  await expect(dapp.locator('#log')).toContainText('"signatureLength": 64');
  await expect(dapp.locator('#log')).toContainText('"confirmed": true', { timeout: 60_000 });
});

test('closing the approval window rejects the request within 2 s', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  const approval = await openApproval(context, () => dapp.locator('#connect').click(), dapp);
  await approval.close();
  await expect(dapp.locator('#log')).toContainText('Approval window closed', { timeout: 2_000 });
  await expect(dapp.locator('#log')).not.toContainText('"accounts"');
});

test('a connected site connects again without a window; a silent connect never prompts', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  // Before any approval: silent returns nothing and opens nothing.
  await dapp.locator('#connectSilent').click();
  await expect(dapp.locator('#log')).toContainText('"silent": true', { timeout: 15_000 });
  await expect(dapp.locator('#log')).toContainText('"accounts": []');
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
  await expect
    .poll(() => context.pages().filter((page) => page.url().includes('approve.html')).length, { timeout: 5_000 })
    .toBe(0);

  // Connected: a second connect answers straight away, no window.
  await dapp.evaluate(() => {
    document.getElementById('log')!.textContent = '';
  });
  await dapp.locator('#connect').click();
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);

  // ...and so does silent.
  await dapp.locator('#connectSilent').click();
  await expect(dapp.locator('#log')).toContainText('"silent": true', { timeout: 15_000 });
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/);
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});

test('revoking in Settings makes the next connect prompt again', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await popup.bringToFront();
  await popup.getByTestId('open-settings').click();
  const site = popup.getByTestId('settings-site');
  await expect(site).toHaveCount(1);
  await expect(site).toHaveAttribute('data-origin', 'http://localhost:5174');
  await popup.getByTestId('settings-revoke-site').click();
  await expect(popup.getByTestId('settings-no-sites')).toBeVisible();

  // The page hears about it...
  await expect(dapp.locator('#log')).toContainText('"event": "change"', { timeout: 5_000 });
  await expect(dapp.locator('#log')).toContainText('"accounts": []');

  // ...and has to ask again.
  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
});

test('signMessage from a never-connected origin is rejected without a window', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  const signed = await postToBridge(dapp, { type: 'SIGN_MESSAGE', payload: { messages: [[104, 105]] } });
  expect(signed.response).toMatchObject({ success: false, error: 'Not connected' });
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});

test('locking the wallet empties the connected page’s accounts', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await popup.bringToFront();
  await popup.getByLabel('Lock wallet').click();
  await expect(popup.getByTestId('unlock-password')).toBeVisible();
  await expect(dapp.locator('#log')).toContainText('"event": "change"', { timeout: 5_000 });
  await expect(dapp.locator('#log')).toContainText('"accounts": []');
});

test('closing the dApp tab withdraws its request and closes the approval window', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  const approval = await openApproval(context, () => dapp.locator('#connect').click(), dapp);
  const closed = approval.waitForEvent('close', { timeout: 10_000 });
  await dapp.close();
  await closed;
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});

test('revoking a site while its request is pending rejects it; a late Approve is refused', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
  const approval = await openApproval(context, () => dapp.locator('#signMessage').click(), dapp);

  await popup.bringToFront();
  await popup.getByTestId('open-settings').click();
  await popup.getByTestId('settings-revoke-site').click();
  await expect(popup.getByTestId('settings-no-sites')).toBeVisible();

  // The page's poll sees the rejection and the site is told it is disconnected.
  await expect(dapp.locator('#log')).toContainText(/Site revoked|"accounts": \[\]/, { timeout: 5_000 });
  await expect(dapp.locator('#log')).not.toContainText('signature');

  // The window is still open on a request the worker has already settled.
  await approval.bringToFront();
  await approval.getByTestId('approval-approve').click();
  await expect(approval.getByText(/Approval expired/)).toBeVisible({ timeout: 5_000 });
  await expect(dapp.locator('#log')).not.toContainText('signature');
});

test('locking underneath an open approval asks for the password again, then shows the request expired', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const popup = await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });

  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });
  const approval = await openApproval(context, () => dapp.locator('#signMessage').click(), dapp);

  await popup.bringToFront();
  await popup.getByLabel('Lock wallet').click();
  await expect(popup.getByTestId('unlock-password')).toBeVisible();

  // The lock rejected the request and the window asks for the password again.
  await expect(dapp.locator('#log')).toContainText(/Wallet locked|"accounts": \[\]/, { timeout: 5_000 });
  await expect(approval.getByTestId('unlock-password')).toBeVisible({ timeout: 5_000 });
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await approval.getByTestId('unlock-submit').click();

  // Unlocked, but the request is gone: Approve stays disabled and the popup followed the unlock.
  await expect(approval.getByTestId('approval-expired')).toBeVisible({ timeout: 5_000 });
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await expect(popup.getByTestId('open-receive')).toBeVisible({ timeout: 10_000 });
  await expect(dapp.locator('#log')).not.toContainText('signature');
});

/** The approval window showing its inline unlock form (a locked connect or sign). */
async function waitForUnlock(context: BrowserContext): Promise<Page> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (!page.url().includes('approve.html')) continue;
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

  // GET_ACCOUNTS needs a connected origin; a stranger gets 'Not connected' and no window.
  const stranger = await postToBridge(dapp, { type: 'GET_ACCOUNTS', payload: {} });
  expect(stranger.response).toMatchObject({ success: false, error: 'Not connected' });
  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

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
    payload: { messages: [new Array(64 * 1024 + 1).fill(0)] },
  });
  expect(oversize.error).toBe('Invalid messages');
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});

test('two transactions in one signTransaction call open one approval and come back signed in order', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });
  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  const approval = await openApproval(context, () => dapp.locator('#signAll').click(), dapp);
  expect(context.pages().filter((page) => page.url().includes('approve.html'))).toHaveLength(1);
  await expect(approval.getByTestId('approval-item')).toHaveCount(2);
  await expect(approval.getByText('Transaction 2 of 2')).toBeVisible();
  await approval.getByTestId('approval-approve').click();

  await expect(dapp.locator('#log')).toContainText('"signedCount": 2', { timeout: 30_000 });
  // No second window ever opened for the second transaction.
  await expect
    .poll(() => context.pages().filter((page) => page.url().includes('approve.html')).length, { timeout: 5_000 })
    .toBe(0);
});

test('a chain the wallet is not on is refused with the Settings hint, without a window', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });
  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await dapp.locator('#signWrongChain').click();
  await expect(dapp.locator('#log')).toContainText('Cinder is on Devnet; switch networks in Settings', { timeout: 15_000 });
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});

test('signMessage over serialized transaction bytes is refused before a window opens', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importAndUnlock(context, extensionId);

  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await expect(dapp.locator('#log')).toContainText('registered Cinder Wallet', { timeout: 15_000 });
  await approveNext(context, () => dapp.locator('#connect').click(), dapp);
  await expect(dapp.locator('#log')).toContainText(/"accounts":\s*\[\s*"/, { timeout: 15_000 });

  await dapp.locator('#signTxAsMessage').click();
  await expect(dapp.locator('#log')).toContainText('Refusing to sign a transaction as a message', { timeout: 15_000 });
  expect(context.pages().some((page) => page.url().includes('approve.html'))).toBe(false);
});
