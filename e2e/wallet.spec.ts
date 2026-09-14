import { CHAIN_TIMEOUT_MS, skipUnlessFixtureHolds } from './devnet';
import { expect, test } from './fixtures';
import { importAndUnlock, importWallet, openPopup, TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from './popup';

/** A funded devnet address that is not the fixture wallet; nothing is sent to it here. */
const UNUSED = 'So11111111111111111111111111111111111111112';

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

test('the Send sheet keeps keyboard focus inside it and hands it back on Escape', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  // It reaches Review, so Continue has to be enabled, so the fixture has to cover
  // the 0.001 it types plus the fee. An empty faucet address is not a focus bug.
  await skipUnlessFixtureHolds(1_000_000n + 5_000n, 'reaching Review to check focus');
  const popup = await importAndUnlock(context, extensionId);

  /** Where focus is: whether it is inside the sheet, and which control it is on. */
  const focus = () =>
    popup.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      const sheet = document.querySelector('[role="dialog"]');
      return {
        inside: Boolean(element && sheet?.contains(element)),
        at: element?.getAttribute('data-testid') ?? element?.getAttribute('aria-label') ?? element?.tagName ?? '',
      };
    });

  await popup.getByTestId('open-send').click();
  await expect(popup.getByTestId('send-recipient')).toBeVisible();

  // Opening moves focus into the sheet, onto its first control.
  expect(await focus()).toEqual({ inside: true, at: 'Close' });

  // Shift+Tab from the first control wraps to the last one in the sheet...
  await popup.keyboard.press('Shift+Tab');
  const last = await focus();
  expect(last.inside).toBe(true);
  expect(last.at).not.toBe('Close');

  // ...and Tab from the last control comes back round to the first.
  await popup.keyboard.press('Tab');
  expect(await focus()).toEqual({ inside: true, at: 'Close' });

  // Walking the whole sheet never lands on the dashboard behind it.
  const walked: string[] = [];
  for (let step = 0; step < 10; step += 1) {
    await popup.keyboard.press('Tab');
    const at = await focus();
    expect(at.inside).toBe(true);
    walked.push(at.at);
  }
  expect(walked).toContain('send-recipient');
  expect(walked).toContain('send-amount');
  // It came round again rather than running out of controls.
  expect(walked).toContain('Close');

  // Stepping to Review unmounts the control that had focus, so the sheet takes
  // it again: focus lands on the review step rather than falling to the body.
  await expect(popup.getByTestId('send-available')).not.toHaveText('\u2014', { timeout: CHAIN_TIMEOUT_MS });
  await popup.getByTestId('send-recipient').fill(UNUSED);
  await popup.getByTestId('send-amount').fill('0.001');
  await popup.getByTestId('send-ack').check();
  await popup.getByTestId('send-continue').click();
  await expect(popup.getByTestId('send-review')).toBeVisible();
  const onReview = await popup.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const sheet = document.querySelector('[role="dialog"]');
    return { inside: Boolean(element && sheet?.contains(element)), at: element?.textContent?.trim() ?? '' };
  });
  expect(onReview).toEqual({ inside: true, at: 'Back' });

  // Escape closes the sheet and gives focus back to the button that opened it.
  await popup.keyboard.press('Escape');
  await expect(popup.getByTestId('send-review')).toHaveCount(0);
  await expect
    .poll(() => popup.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''), { timeout: 5_000 })
    .toBe('open-send');
});
