import { expect, test } from './fixtures';
import { TEST_ADDRESS, importAndUnlock } from './popup';

/** Every host the popup may read from: the seeded Helius key, the public devnet node, and both mainnet defaults. */
const RPC_HOSTS = /(helius-rpc\.com|api\.devnet\.solana\.com|api\.mainnet-beta\.solana\.com|solana-rpc\.publicnode\.com)/;

/** Rows per history page in `useTransactions`. */
const HISTORY_PAGE_SIZE = 20;

/**
 * Ask devnet, from the test process, whether the fixture has more than one page
 * of history. Throws when devnet did not answer: a rate limit must fail the test,
 * not pass it as "one page".
 */
async function devnetSignatureCount(limit: number): Promise<number> {
  const response = await fetch('https://api.devnet.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [TEST_ADDRESS, { limit }],
    }),
  });
  if (!response.ok) throw new Error(`devnet getSignaturesForAddress answered ${response.status}`);
  const json = (await response.json()) as { result?: unknown[]; error?: { code?: number; message?: string } };
  if (json.error) throw new Error(`devnet getSignaturesForAddress failed: ${json.error.message ?? json.error.code}`);
  return json.result?.length ?? 0;
}

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

test('shows error cards, not zeros, when no RPC endpoint answers', async ({ context, extensionId }) => {
  const first = await importAndUnlock(context, extensionId);
  await first.close();

  // A fresh popup with every RPC host aborted before its first query fires; the vault stays unlocked in the worker.
  const popup = await context.newPage();
  await popup.route(RPC_HOSTS, (route) => route.abort());
  await popup.goto(`chrome-extension://${extensionId}/index.html`);

  const balanceError = popup.getByTestId('balance-error');
  await expect(balanceError).toBeVisible({ timeout: 30_000 });
  await expect(balanceError).toContainText('No RPC endpoint reachable from this network. Add one in Settings.');
  await expect(balanceError.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(popup.getByTestId('sol-balance')).toHaveText(/^—/);
  await expect(popup.getByTestId('sol-balance')).not.toHaveText(/0\.0000/);
  await expect(popup.getByTestId('tokens-error')).toBeVisible();

  await popup.getByTestId('nav-nfts').click();
  await expect(popup.getByTestId('nfts-error')).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByText('No collectibles')).toHaveCount(0);

  await popup.getByTestId('nav-activity').click();
  await expect(popup.getByTestId('history-error')).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByText('No activity yet')).toHaveCount(0);
});

test('activity pages with Load more when the fixture has more than one page', async ({ context, extensionId }) => {
  const signatures = await devnetSignatureCount(HISTORY_PAGE_SIZE + 1);
  test.skip(signatures <= HISTORY_PAGE_SIZE, 'fixture has one page of history');

  const popup = await importAndUnlock(context, extensionId);
  // The build under test must be the devnet one, or the rows below come from the wrong chain.
  await expect(popup.getByTestId('network-pill')).toHaveText('Devnet');

  await popup.getByTestId('nav-activity').click();
  // Every row, including one whose details could not be fetched, carries `activity-row`.
  const rows = popup.getByTestId('activity-row');
  const loadMore = popup.getByTestId('history-load-more');

  await expect(loadMore).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(HISTORY_PAGE_SIZE);

  await loadMore.click();
  await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(HISTORY_PAGE_SIZE);
});
