import { expect, test } from './fixtures';
import { importAndUnlock, TEST_ADDRESS } from './popup';

/*
 * What this covers: the Copy button calls `navigator.clipboard.writeText` with the
 * active account's full address (not the truncated display form) and only toasts
 * after that call resolves.
 *
 * What it does NOT cover: the real clipboard write. `navigator.clipboard` is
 * replaced with a recording stub here because the browser's own clipboard cannot be
 * reached from this page — `chrome-extension://` is an opaque origin, so Playwright's
 * `grantPermissions(['clipboard-read'])` is rejected for it and nothing in the
 * extension origin can read the value back. So this proves the wiring, never that
 * Chrome accepted the write.
 *
 * Because of that gap the `clipboardWrite` permission stays in `manifest.json`. It
 * raises no install warning, and this page runs here as a tab, not as the real
 * toolbar action popup, where a `writeText` without the permission can be refused
 * for a document Chrome does not consider focused. Confirm the toolbar popup by hand
 * (README → Chrome click-through, step 4) before anyone removes it.
 */
test('Receive copy writes the full address and toasts Address copied', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await popup.getByTestId('open-receive').click();
  await popup.evaluate(() => {
    const written: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = written;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
  });
  await popup.getByTestId('receive-copy').click();
  await expect(popup.getByText('Address copied')).toBeVisible();

  const copied = await popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([TEST_ADDRESS]);
});
