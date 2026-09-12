import { expect, test } from './fixtures';
import { importAndUnlock, importWallet, TEST_MNEMONIC, TEST_PASSWORD } from './popup';

const NEXT_PASSWORD = 'TestWallet2!';

test('settings update auto-lock, export seed, and change password', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const popup = await importAndUnlock(context, extensionId);

  await popup.getByTestId('open-settings').click();
  await popup.getByTestId('settings-autolock').selectOption('5');
  await expect(popup.getByText('Auto-lock updated')).toBeVisible();

  await popup.getByTestId('settings-show-seed').click();
  await popup.getByTestId('settings-seed-password').fill(TEST_PASSWORD);
  await popup.getByTestId('settings-seed-submit').click();
  await expect(popup.getByTestId('settings-seed-word').first()).toBeVisible();
  const words = await popup.getByTestId('settings-seed-word').allTextContents();
  expect(words.join(' ')).toBe(TEST_MNEMONIC);
  await popup.getByRole('button', { name: 'Done' }).click();

  await popup.getByTestId('settings-change-password').click();
  await popup.getByTestId('settings-current-password').fill(TEST_PASSWORD);
  await popup.getByTestId('settings-new-password').fill(NEXT_PASSWORD);
  await popup.getByTestId('settings-confirm-password').fill(NEXT_PASSWORD);
  await popup.getByTestId('settings-password-save').click();
  await expect(popup.getByText('Password changed')).toBeVisible();

  await popup.getByLabel('Lock wallet').click();
  await popup.getByTestId('unlock-password').fill(NEXT_PASSWORD);
  await popup.getByTestId('unlock-submit').click();
  await expect(popup.getByTestId('open-settings')).toBeVisible();
  if (await popup.getByRole('heading', { name: 'Settings' }).isVisible()) {
    await popup.getByTestId('open-settings').click();
  }
  await expect(popup.getByTestId('open-receive')).toBeVisible();
});

test('clear wallet data resets the settings cache to the worker defaults', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const popup = await importAndUnlock(context, extensionId);

  await popup.getByTestId('open-settings').click();
  // The build default is devnet (.env VITE_NETWORK=devnet), so move away from it first.
  await popup.getByTestId('settings-cluster').selectOption('mainnet-beta');
  await expect(popup.getByText('Using Solana Mainnet')).toBeVisible();
  await expect(popup.getByTestId('settings-cluster')).toHaveValue('mainnet-beta');

  await popup.getByRole('button', { name: 'Clear all wallet data', exact: true }).click();
  await popup.getByRole('button', { name: 'Clear data', exact: true }).click();
  await expect(popup.getByTestId('import-existing-wallet')).toBeVisible();

  // Same popup page, so the React Query cache survives: it must have been re-synced
  // with the worker, which reverted to defaults on CLEAR_WALLET. The settings flag
  // in Redux also survives, so the dashboard remounts straight into Settings.
  await importWallet(popup, 'settings-cluster');
  await expect(popup.getByTestId('settings-cluster')).toHaveValue('devnet');
});
