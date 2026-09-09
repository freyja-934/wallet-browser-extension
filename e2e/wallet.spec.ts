import { expect, test } from './fixtures';
import { importWallet, openPopup, TEST_PASSWORD } from './popup';

test('import then reopen shows Unlock, not Create', async ({ context, extensionId }) => {
  const created = await openPopup(context, extensionId);
  await expect(created.getByTestId('import-existing-wallet')).toBeVisible();
  await importWallet(created);
  await created.evaluate(() => chrome.runtime.sendMessage({ type: 'LOCK' }));
  await created.close();

  const reopened = await openPopup(context, extensionId);
  await expect(reopened.getByTestId('unlock-password')).toBeVisible();
  await expect(reopened.getByTestId('import-existing-wallet')).toHaveCount(0);

  await reopened.getByTestId('unlock-password').fill(TEST_PASSWORD);
  await reopened.getByTestId('unlock-submit').click();
  await expect(reopened.getByTestId('open-receive')).toBeVisible();
});
