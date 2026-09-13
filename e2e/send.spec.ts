import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { importAndUnlock, TEST_ADDRESS } from './popup';

const UNUSED = 'So11111111111111111111111111111111111111112';
/** What a one-signature transfer costs on devnet; the fee row and the balance drop both say so. */
const FEE_LAMPORTS = 5000n;

/** `1.5` -> 1500000000n: the popup's own conversion, kept here so the test does not import from `src/`. */
function toLamports(sol: string): bigint {
  const [whole, frac = ''] = sol.trim().split('.');
  return BigInt(whole || '0') * 1_000_000_000n + BigInt(frac.padEnd(9, '0').slice(0, 9) || '0');
}

/** The lamports named by a `<figure> SOL` line, e.g. the fee row or the available text. */
function lamportsIn(line: string): bigint {
  const match = /([\d.]+) SOL/.exec(line);
  if (!match) throw new Error(`no SOL figure in '${line}'`);
  return toLamports(match[1]);
}

async function openSend(popup: Page): Promise<void> {
  await popup.getByTestId('open-send').click();
  // The balance query must settle before Continue can enable, so wait for a real figure.
  await expect(popup.getByTestId('send-available')).not.toHaveText('—', { timeout: 30_000 });
}

test('Send rejects junk address then reaches Review with a fee', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await openSend(popup);
  await popup.getByTestId('send-recipient').fill('not-a-solana-address');
  await expect(popup.getByText('Invalid Solana address')).toBeVisible();

  await popup.getByTestId('send-recipient').fill(UNUSED);
  await popup.getByTestId('send-amount').fill('0.001');
  await popup.getByTestId('send-ack').check();
  await expect(popup.getByTestId('send-continue')).toBeEnabled();
  await popup.getByTestId('send-continue').click();

  await expect(popup.getByTestId('send-review')).toBeVisible();
  await expect(popup.getByTestId('send-review')).toContainText('0.001 SOL');
  await expect(popup.getByTestId('send-fee')).toContainText(/[\d.]+ SOL/, { timeout: 30_000 });
  expect(lamportsIn(await popup.getByTestId('send-fee').innerText())).toBe(FEE_LAMPORTS);
  await expect(popup.getByRole('button', { name: 'Confirm' })).toBeVisible();
});

test('Max sends the balance minus the fee', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await openSend(popup);
  const available = lamportsIn(await popup.getByTestId('send-available').innerText());
  expect(available).toBeGreaterThan(FEE_LAMPORTS);

  await popup.getByTestId('send-recipient').fill(UNUSED);
  await popup.getByTestId('send-max').click();
  const typed = await popup.getByTestId('send-amount').inputValue();
  expect(toLamports(typed)).toBe(available - FEE_LAMPORTS);
  await expect(popup.getByTestId('send-amount-error')).toHaveCount(0);

  await popup.getByTestId('send-ack').check();
  await expect(popup.getByTestId('send-continue')).toBeEnabled();
  await popup.getByTestId('send-continue').click();

  await expect(popup.getByTestId('send-review')).toBeVisible();
  await expect(popup.getByTestId('send-fee')).toContainText(/[\d.]+ SOL/, { timeout: 30_000 });
  const fee = lamportsIn(await popup.getByTestId('send-fee').innerText());
  await expect(popup.getByTestId('send-review')).toContainText(`${typed} SOL`);
  expect(toLamports(typed)).toBe(available - fee);
});

test('Amount with more decimals than SOL has is refused', async ({ context, extensionId }) => {
  const popup = await importAndUnlock(context, extensionId);

  await openSend(popup);
  await popup.getByTestId('send-recipient').fill(UNUSED);
  await popup.getByTestId('send-amount').fill('0.1234567891');
  await popup.getByTestId('send-ack').check();
  await expect(popup.getByTestId('send-amount-error')).toHaveText('Use at most 9 decimal places');
  await expect(popup.getByTestId('send-continue')).toBeDisabled();

  // One lamport: the finest amount SOL has, and the parser takes it.
  await popup.getByTestId('send-amount').fill('0.000000001');
  await expect(popup.getByTestId('send-amount-error')).toHaveCount(0);
  await expect(popup.getByTestId('send-continue')).toBeEnabled();
});

test('Sending to the wallet itself costs exactly the fee', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const owner = new PublicKey(TEST_ADDRESS);
  const popup = await importAndUnlock(context, extensionId);

  await openSend(popup);
  const before = BigInt(await connection.getBalance(owner, 'confirmed'));
  // The fixture must keep the 0.001 SOL it sends itself, the fee, and enough to stay
  // rent-exempt — the worker refuses a send that would leave it between zero and the minimum.
  const rent = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  expect(before).toBeGreaterThan(1_000_000n + FEE_LAMPORTS + rent);

  await popup.getByTestId('send-recipient').fill(TEST_ADDRESS);
  await popup.getByTestId('send-amount').fill('0.001');
  await popup.getByTestId('send-ack').check();
  await popup.getByTestId('send-continue').click();

  await expect(popup.getByTestId('send-fee')).toContainText(/[\d.]+ SOL/, { timeout: 30_000 });
  // The wallet exists, so no account gets created and nothing warns.
  await expect(popup.getByTestId('send-creates-account')).toHaveCount(0);
  // Whatever the cluster charges today, the balance has to drop by exactly what Review promised.
  const fee = lamportsIn(await popup.getByTestId('send-fee').innerText());
  await expect(popup.getByTestId('send-confirm')).toBeEnabled();
  await popup.getByTestId('send-confirm').click();

  await expect(popup.getByText(/Transaction sent/)).toBeVisible({ timeout: 60_000 });

  // A self-transfer moves nothing; only the fee leaves, so the run can repeat.
  await expect
    .poll(async () => BigInt(await connection.getBalance(owner, 'confirmed')), { timeout: 30_000 })
    .toBe(before - fee);
});
