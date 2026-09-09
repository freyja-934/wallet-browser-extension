import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { importAndUnlock } from './popup';

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
  await expect(dapp.locator('#log')).toContainText('registered Lumen', { timeout: 15_000 });

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
