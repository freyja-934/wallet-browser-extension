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

test('custom RPC: an http URL is refused, an https one is probed, saved, shown on the pill, and cleared', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const popup = await importAndUnlock(context, extensionId);
  // With no custom URL the primary host is the public devnet host, or Helius when the
  // dev build carries a key; either way it is a bare hostname and changes once a custom URL is set.
  const initialHost = await popup.getByTestId('network-pill').getAttribute('title');
  expect(initialHost).toMatch(/^[a-z0-9.-]+$/);
  expect(initialHost).not.toBe('rpc.example');

  await popup.getByTestId('open-settings').click();
  await expect(popup.getByTestId('settings-rpc-url')).toHaveValue('');

  // Rejected in the click handler, before any permission request or network call.
  await popup.getByTestId('settings-rpc-url').fill('http://rpc.example');
  await popup.getByTestId('settings-rpc-save').click();
  await expect(popup.getByText('RPC URL must start with https://')).toBeVisible();

  // Already in host_permissions, so chrome.permissions.request resolves without a native prompt.
  const RPC_URL = 'https://api.devnet.solana.com';
  const HELIUS_KEY = 'e2e-not-a-real-key';
  await popup.getByTestId('settings-rpc-url').fill(RPC_URL);
  await popup.getByTestId('settings-helius-key').fill(HELIUS_KEY);
  await popup.getByTestId('settings-rpc-save').click();
  await expect(popup.getByText('RPC settings saved')).toBeVisible({ timeout: 20_000 });

  // Persisted in the worker: a fresh popup reads it back and the pill reports the custom host.
  await popup.reload();
  await expect(popup.getByTestId('open-settings')).toBeVisible();
  await expect(popup.getByTestId('network-pill')).toHaveAttribute('title', new URL(RPC_URL).host);
  await popup.getByTestId('open-settings').click();
  await expect(popup.getByTestId('settings-rpc-url')).toHaveValue(RPC_URL);
  await expect(popup.getByTestId('settings-helius-key')).toHaveValue(HELIUS_KEY);
  await expect(popup.getByTestId('settings-helius-key')).toHaveAttribute('type', 'password');

  await popup.getByTestId('settings-rpc-clear').click();
  await expect(popup.getByText('RPC settings cleared')).toBeVisible();
  await expect(popup.getByTestId('settings-rpc-url')).toHaveValue('');
  // A cleared key stays cleared: the build-time key (if any) must not seed the field again,
  // so with no custom URL and no key the primary is the public devnet host.
  await expect(popup.getByTestId('settings-helius-key')).toHaveValue('');
  await expect(popup.getByTestId('network-pill')).toHaveAttribute('title', 'api.devnet.solana.com');

  // The worker agrees after a fresh read: nothing comes back on reload either.
  await popup.reload();
  await expect(popup.getByTestId('open-settings')).toBeVisible();
  await expect(popup.getByTestId('network-pill')).toHaveAttribute('title', 'api.devnet.solana.com');
  await popup.getByTestId('open-settings').click();
  await expect(popup.getByTestId('settings-rpc-url')).toHaveValue('');
  await expect(popup.getByTestId('settings-helius-key')).toHaveValue('');
});

test('custom RPC: a failed health probe shows the error, stores nothing, and re-enables Save', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const popup = await importAndUnlock(context, extensionId);
  const RPC_URL = 'https://api.devnet.solana.com';
  const pattern = `${RPC_URL}/**`;
  // The probe runs from the popup page, so a page route can make the endpoint answer 500.
  await popup.route(pattern, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"e2e"}' }),
  );

  await popup.getByTestId('open-settings').click();
  await popup.getByTestId('settings-rpc-url').fill(RPC_URL);
  await popup.getByTestId('settings-rpc-save').click();
  await expect(popup.getByText('Endpoint answered HTTP 500')).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByTestId('settings-rpc-save')).toBeEnabled();
  await expect(popup.getByTestId('settings-rpc-url')).toBeEnabled();

  // Nothing was stored: a fresh popup reads an empty field back from the worker.
  await popup.unroute(pattern);
  await popup.reload();
  await expect(popup.getByTestId('open-settings')).toBeVisible();
  await expect(popup.getByTestId('network-pill')).not.toHaveAttribute('title', new URL(RPC_URL).host);
  await popup.getByTestId('open-settings').click();
  await expect(popup.getByTestId('settings-rpc-url')).toHaveValue('');
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

test('add a second account, switch to it, rename it, and switch back', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const popup = await importAndUnlock(context, extensionId);

  const switcher = popup.getByTestId('account-switcher');
  await expect(switcher).toContainText('Account 1');
  const firstAddress = await popup.getByTestId('header-address').innerText();

  await switcher.click();
  await expect(popup.getByTestId('account-option')).toHaveCount(1);
  await popup.getByTestId('account-add').click();
  await expect(popup.getByTestId('account-option')).toHaveCount(2);

  // The second account is a different address, and the header follows the switch.
  await popup.getByTestId('account-option').nth(1).click();
  await expect(switcher).toContainText('Account 2');
  const secondAddress = await popup.getByTestId('header-address').innerText();
  expect(secondAddress).not.toBe(firstAddress);

  // Export private key names the account the header has selected.
  await popup.getByTestId('open-settings').click();
  await popup.getByTestId('settings-show-key').click();
  await expect(popup.getByTestId('settings-key-account')).toHaveText('Export key for Account 2');
  await popup.getByRole('button', { name: 'Cancel' }).click();
  await popup.getByTestId('open-settings').click();

  await switcher.click();
  await popup.getByTestId('account-rename').nth(1).click();
  await popup.getByTestId('account-rename-input').fill('Savings');
  await popup.getByTestId('account-rename-input').press('Enter');
  await expect(switcher).toContainText('Savings');

  // Only Enter commits a rename: clicking away abandons the draft, and an empty
  // one leaves edit mode rather than sticking there with nothing to submit.
  await popup.getByTestId('account-rename').nth(1).click();
  await popup.getByTestId('account-rename-input').fill('Scratch');
  await popup.getByTestId('account-rename-input').blur();
  await expect(popup.getByTestId('account-rename-input')).toHaveCount(0);
  await expect(popup.getByTestId('account-option').nth(1)).toContainText('Savings');
  await popup.getByTestId('account-rename').nth(1).click();
  await popup.getByTestId('account-rename-input').fill('');
  await popup.getByTestId('account-rename-input').press('Enter');
  await expect(popup.getByTestId('account-rename-input')).toHaveCount(0);
  await expect(popup.getByTestId('account-option').nth(1)).toContainText('Savings');

  // The list is still open behind the rename, so the switch back is one click.
  await popup.getByTestId('account-option').nth(0).click();
  await expect(switcher).toContainText('Account 1');
  await expect(popup.getByTestId('header-address')).toHaveText(firstAddress);

  // Both accounts, and the new name, survive a lock and unlock — on the account
  // the user was actually on when the wallet locked.
  await popup.getByLabel('Lock wallet').click();
  await popup.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await popup.getByTestId('unlock-submit').click();
  await expect(popup.getByTestId('open-receive')).toBeVisible();
  await expect(switcher).toContainText('Account 1');
  await expect(popup.getByTestId('header-address')).toHaveText(firstAddress);
  await switcher.click();
  await expect(popup.getByTestId('account-option')).toHaveCount(2);
  await expect(popup.getByTestId('account-option').nth(1)).toContainText('Savings');

  // And the same the other way round: locked while on the second account, the
  // unlock comes back there rather than quietly moving to the first address.
  await popup.getByTestId('account-option').nth(1).click();
  await expect(switcher).toContainText('Savings');
  await popup.getByLabel('Lock wallet').click();
  await popup.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await popup.getByTestId('unlock-submit').click();
  await expect(popup.getByTestId('open-receive')).toBeVisible();
  await expect(switcher).toContainText('Savings');
  await expect(popup.getByTestId('header-address')).toHaveText(secondAddress);
});
