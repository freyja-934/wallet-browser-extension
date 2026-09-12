import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Public BIP39 fixture + password. See docs/test-wallet.md. */
export const TEST_PASSWORD = 'TestWallet1!';
export const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const TEST_ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/** Import the fixture wallet; `landing` is the testid that proves the dashboard mounted. */
export async function importWallet(page: Page, landing = 'open-receive'): Promise<void> {
  await page.getByTestId('import-existing-wallet').click();
  await page.getByTestId('seed-paste').fill(TEST_MNEMONIC);
  await page.getByTestId('seed-import-submit').click();
  await page.getByTestId('password-input').fill(TEST_PASSWORD);
  await page.getByTestId('password-confirm').fill(TEST_PASSWORD);
  await expect(page.getByTestId('password-submit')).toBeEnabled();
  await page.getByTestId('password-submit').click();
  const failed = page.getByText('Failed to create wallet');
  await Promise.race([
    page.getByTestId(landing).waitFor({ timeout: 30_000 }),
    failed.waitFor({ timeout: 30_000 }).then(async () => {
      throw new Error(`import failed; body=${await page.locator('body').innerText()}`);
    }),
  ]);
}

export async function unlockWallet(page: Page): Promise<void> {
  await page.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await page.getByTestId('unlock-submit').click();
  await page.getByTestId('open-receive').waitFor();
}

export async function importAndUnlock(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await importWallet(page);
  return page;
}
