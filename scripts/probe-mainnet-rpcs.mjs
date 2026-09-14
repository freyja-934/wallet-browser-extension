/**
 * Probe keyless mainnet RPC candidates from a real extension origin.
 *
 *   just ext                       # or any build; the popup page is all this needs
 *   node scripts/probe-mainnet-rpcs.mjs
 *   CINDER_OUT_DIR=dist-store node scripts/probe-mainnet-rpcs.mjs
 *
 * Why this exists rather than a curl one-liner: curl does not enforce CORS, so it
 * reports success for endpoints a browser will refuse. `solana.leorpc.com` is the
 * worked example — its preflight answers 200 with `access-control-allow-origin: *`
 * and no `access-control-allow-headers` at all, which reads as working under curl.
 * Only a fetch issued from a `chrome-extension://` page tells you what the wallet
 * will actually experience, so that is what this does.
 *
 * It also probes the two Jupiter endpoints the keyless token list depends on, for
 * the same reason and in the same way: they are the fallback for discovering which
 * mints a Mainnet address holds when no endpoint will enumerate token accounts, and
 * the claim that they serve a `chrome-extension://` origin has to stay re-verifiable.
 * Jupiter supplies discovery and cosmetics only — every number the wallet shows is
 * read from the chain — so what is checked here is reachability and shape, nothing more.
 *
 * Nothing here signs or sends. It reads one balance per endpoint.
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(repo, process.env.CINDER_OUT_DIR || 'dist');

/** Any address will do; this is the public fixture, and the call is read-only. */
const ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

/** The keyless token-discovery fallback; see `src/services/jupiter.ts`. */
const JUPITER = [
  {
    label: 'jup.ag ultra/v1/balances',
    url: (address) => `https://lite-api.jup.ag/ultra/v1/balances/${address}`,
    describe: (body) =>
      body && typeof body === 'object' && !Array.isArray(body)
        ? `serves this origin (${Object.keys(body).length} entries incl. SOL)`
        : 'no object body',
  },
  {
    label: 'jup.ag tokens/v2/search',
    // Two well-known mints: enough to prove the shape without leaking an address.
    url: () =>
      'https://lite-api.jup.ag/tokens/v2/search?query=' +
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,So11111111111111111111111111111111111111112',
    describe: (body) =>
      Array.isArray(body) ? `serves this origin (${body.length} rows, e.g. ${body[0]?.symbol ?? '?'})` : 'no array body',
  },
];

const CANDIDATES = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
  'https://solana.leorpc.com/?api_key=FREE',
  'https://solana.api.onfinality.io/public',
  'https://solana.drpc.org',
  'https://endpoints.omniatech.io/v1/sol/mainnet/public',
];

async function main() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html`);
  console.log(`probing as chrome-extension://${id}\n`);

  for (const url of CANDIDATES) {
    const outcome = await page.evaluate(
      async ({ url, address }) => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
          });
          let body;
          try {
            body = await response.json();
          } catch {
            body = undefined;
          }
          return { status: response.status, body };
        } catch (error) {
          // A CORS refusal and a blocked host look the same from here: both are
          // an opaque TypeError, which is exactly what the wallet would see.
          return { status: 'blocked', body: String(error).slice(0, 100) };
        }
      },
      { url, address: ADDRESS }
    );

    const body = outcome.body;
    const lamports = body?.result?.value;
    const verdict =
      typeof lamports === 'number'
        ? `serves this origin (${lamports / 1e9} SOL)`
        : body?.error
          ? `refused: ${JSON.stringify(body.error).slice(0, 90)}`
          : typeof body === 'string'
            ? body
            : 'no JSON-RPC answer';
    console.log(`${url.padEnd(56, ' ')} ${String(outcome.status).padEnd(8)} ${verdict}`);
  }

  console.log('');
  for (const endpoint of JUPITER) {
    const outcome = await page.evaluate(
      async ({ url }) => {
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } });
          let body;
          try {
            body = await response.json();
          } catch {
            body = undefined;
          }
          return { status: response.status, body };
        } catch (error) {
          return { status: 'blocked', body: String(error).slice(0, 100) };
        }
      },
      { url: endpoint.url(ADDRESS) }
    );

    const verdict =
      outcome.status === 200 ? endpoint.describe(outcome.body) : `refused: ${String(outcome.body).slice(0, 90)}`;
    console.log(`${endpoint.label.padEnd(56, ' ')} ${String(outcome.status).padEnd(8)} ${verdict}`);
  }

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
