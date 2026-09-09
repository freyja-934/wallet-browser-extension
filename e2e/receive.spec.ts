import { expect, test } from './fixtures';
import { importAndUnlock } from './popup';

test('Receive copy toasts Address copied', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await popup.getByTestId('open-receive').click();
  // chrome-extension:// is an opaque origin; Chromium rejects grantPermissions.
  await popup.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await popup.getByTestId('receive-copy').click();
  await expect(popup.getByText('Address copied')).toBeVisible();
});
