import { expect, test } from './fixtures';
import { importWallet, openPopup, TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from './popup';

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

test('paste import normalises spacing and case', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const page = await openPopup(context, extensionId);
  // What a password manager or a PDF actually hands over: surrounding quotes,
  // mixed case, double spaces, and a line break. Same fixture phrase underneath.
  const words = TEST_MNEMONIC.split(' ').map((word, i) => (i % 2 ? word.toUpperCase() : word));
  const messy = `  "${words.slice(0, 6).join('  ')}\n${words.slice(6).join('  ')}"  `;

  await page.getByTestId('import-existing-wallet').click();
  await page.getByTestId('seed-paste').fill(messy);
  await page.getByTestId('seed-import-submit').click();
  await page.getByTestId('password-input').fill(TEST_PASSWORD);
  await page.getByTestId('password-confirm').fill(TEST_PASSWORD);
  await page.getByTestId('password-submit').click();

  await expect(page.getByTestId('open-receive')).toBeVisible({ timeout: 30_000 });
  // The same wallet the clean phrase produces, not a different derivation.
  await expect(page.getByText(`${TEST_ADDRESS.slice(0, 4)}\u2026${TEST_ADDRESS.slice(-4)}`)).toBeVisible();
});

test('a second create is refused rather than replacing the wallet', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const page = await openPopup(context, extensionId);
  await importWallet(page);
  const short = `${TEST_ADDRESS.slice(0, 4)}\u2026${TEST_ADDRESS.slice(-4)}`;
  await expect(page.getByTestId('header-address')).toHaveText(short);

  // The shape the onboarding retry used to send: the same CREATE_WALLET round
  // trip the popup makes, with no phrase — which the worker would once have read
  // as "generate a fresh one" and written over the wallet just imported.
  const refused = await page.evaluate(
    (password) => chrome.runtime.sendMessage({ type: 'CREATE_WALLET', password }),
    TEST_PASSWORD,
  );
  expect(refused).toMatchObject({ success: false, error: 'Wallet already exists' });
  // With a phrase too: an existing vault is never replaced in place.
  const refusedWithPhrase = await page.evaluate(
    ([password, seedPhrase]) => chrome.runtime.sendMessage({ type: 'CREATE_WALLET', password, seedPhrase }),
    [TEST_PASSWORD, TEST_MNEMONIC],
  );
  expect(refusedWithPhrase).toMatchObject({ success: false, error: 'Wallet already exists' });

  // Same wallet as before, after a fresh read of worker state.
  await page.reload();
  await expect(page.getByTestId('header-address')).toHaveText(short);
});
