import { expect, test } from './fixtures';
import { importAndUnlock } from './popup';

const UNUSED = 'So11111111111111111111111111111111111111112';

test('Send rejects junk address then reaches Review', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await popup.getByTestId('open-send').click();
  await popup.getByTestId('send-recipient').fill('not-a-solana-address');
  await expect(popup.getByText('Invalid Solana address')).toBeVisible();

  await popup.getByTestId('send-recipient').fill(UNUSED);
  await popup.getByTestId('send-amount').fill('0.001');
  await popup.getByTestId('send-ack').check();
  await expect(popup.getByTestId('send-continue')).toBeEnabled();
  await popup.getByTestId('send-continue').click();

  await expect(popup.getByTestId('send-review')).toBeVisible();
  await expect(popup.getByTestId('send-review')).toContainText('0.001 SOL');
  await expect(popup.getByRole('button', { name: 'Confirm' })).toBeVisible();
});
