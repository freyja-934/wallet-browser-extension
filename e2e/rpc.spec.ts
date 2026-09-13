import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import { importAndUnlock, openPopup } from './popup';

const distManifest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'manifest.json');

interface Manifest {
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

interface SettingsShape {
  cluster: 'mainnet-beta' | 'devnet';
  rpcUrl?: string;
  heliusApiKey?: string;
}

type Envelope = { success: true; settings: SettingsShape } | { success: false; error?: string };

// No live publicnode fetch here: reachability varies by network, and the manifest plus the
// worker round-trip are what make the keyless mainnet path possible.
test('the built manifest grants publicnode, drops the hosts it cannot use, and can request any https origin', () => {
  const manifest = JSON.parse(readFileSync(distManifest, 'utf8')) as Manifest;
  const hosts = manifest.host_permissions ?? [];
  expect(hosts).toContain('https://solana-rpc.publicnode.com/*');
  expect(hosts).toContain('https://api.devnet.solana.com/*');
  expect(hosts.some((host) => host.includes('api.testnet.solana.com'))).toBe(false);
  // `api.mainnet-beta.solana.com` 403s every request carrying an `Origin` header, so asking
  // for it would be a permission the extension can never spend. It is out of the rotation too.
  expect(hosts.some((host) => host.includes('api.mainnet-beta.solana.com'))).toBe(false);
  expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
});

test('UPDATE_SETTINGS / GET_SETTINGS round-trip drives the primary endpoint', async ({ context, extensionId }) => {
  test.setTimeout(60_000);
  const popup = await importAndUnlock(context, extensionId);

  const send = (message: Record<string, unknown>) =>
    popup.evaluate(
      (msg) => chrome.runtime.sendMessage(msg) as Promise<Envelope>,
      message,
    );

  const initial = await send({ type: 'GET_SETTINGS' });
  expect(initial.success).toBe(true);
  if (!initial.success) return;
  expect(initial.settings.rpcUrl).toBeUndefined();
  const initialHost = await popup.getByTestId('network-pill').getAttribute('title');
  expect(initialHost).toMatch(/^[a-z0-9.-]+$/);

  // The worker refuses a non-https URL before storing anything.
  const refused = await send({ type: 'UPDATE_SETTINGS', settings: { rpcUrl: 'http://rpc.example' } });
  expect(refused.success).toBe(false);
  if (!refused.success) expect(refused.error).toBe('Invalid settings.rpcUrl');

  // A stored custom URL is first in `rpcUrlsFor`, so the pill names its host once the popup re-reads settings.
  const custom = 'https://api.devnet.solana.com/';
  const updated = await send({ type: 'UPDATE_SETTINGS', settings: { rpcUrl: `  ${custom}  ` } });
  expect(updated.success).toBe(true);
  if (updated.success) expect(updated.settings.rpcUrl).toBe(custom);

  await popup.reload();
  await expect(popup.getByTestId('network-pill')).toHaveAttribute('title', new URL(custom).host);
  const readBack = await send({ type: 'GET_SETTINGS' });
  expect(readBack.success).toBe(true);
  if (readBack.success) expect(readBack.settings.rpcUrl).toBe(custom);

  // '' clears the field; the pill falls back to whatever came first before.
  const cleared = await send({ type: 'UPDATE_SETTINGS', settings: { rpcUrl: '' } });
  expect(cleared.success).toBe(true);
  if (cleared.success) expect(cleared.settings.rpcUrl).toBeUndefined();
  await popup.reload();
  await expect(popup.getByTestId('network-pill')).toHaveAttribute('title', initialHost!);
});

// Opt-in: publicnode reachability depends on the network (an ISP filter blocked it on the
// implementation machine). Run with E2E_LIVE_MAINNET=1 to prove the extension origin gets a 200.
test('keyless mainnet: the popup origin can reach publicnode', async ({ context, extensionId }) => {
  test.skip(!process.env.E2E_LIVE_MAINNET, 'set E2E_LIVE_MAINNET=1 to run the live publicnode check');
  const popup = await openPopup(context, extensionId);
  const status = await popup.evaluate(async () => {
    const response = await fetch('https://solana-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'e2e', method: 'getHealth' }),
    });
    return response.status;
  });
  expect(status).toBe(200);
});
