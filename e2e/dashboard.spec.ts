import { expect, test } from './fixtures';
import { importAndUnlock } from './popup';

test('dashboard tabs settle after import', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await expect(popup.getByTestId('sol-balance')).toBeVisible();
  await expect(popup.getByTestId('sol-balance')).toHaveText(/^[—\d]/);

  await popup.getByTestId('nav-nfts').click();
  await expect(
    popup.getByPlaceholder('Search collectibles').or(popup.getByText('No collectibles')),
  ).toBeVisible({ timeout: 20_000 });

  await popup.getByTestId('nav-activity').click();
  await expect(
    popup.getByText('No activity yet').or(popup.getByText('All')),
  ).toBeVisible({ timeout: 30_000 });
});
