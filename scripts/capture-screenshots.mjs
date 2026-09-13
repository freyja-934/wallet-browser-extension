/**
 * Capture the Chrome Web Store screenshots from the real extension.
 *
 * Loads the built extension into Chromium, walks the flows with the public
 * BIP39 fixture from docs/test-wallet.md, captures each popup at 2x, then
 * composes the 1280x800 listing shots and the two promo tiles.
 *
 *   CINDER_OUT_DIR=dist-shots node scripts/capture-screenshots.mjs
 *
 * Build that directory for the cluster you want in the shots, e.g.
 *   VITE_NETWORK=mainnet-beta CINDER_OUT_DIR=dist-shots pnpm build:extension
 *
 * Nothing here broadcasts: the approval shot signs nothing and is rejected.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.CINDER_OUT_DIR || 'dist';
const extensionPath = path.join(repo, outDir);
const shots = path.join(repo, 'docs/store/screenshots');
const raw = path.join(shots, 'raw');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'TestWallet1!';
const POPUP = { width: 380, height: 600 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(raw, { recursive: true });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: POPUP,
    deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;

  const popup = await context.newPage();
  await popup.setViewportSize(POPUP);
  await popup.goto(`chrome-extension://${id}/index.html`);

  const shot = async (page, name) => {
    await sleep(700);
    await page.screenshot({ path: path.join(raw, `${name}.png`) });
    console.log('captured', name);
  };

  // Import the fixture wallet.
  await popup.getByTestId('import-existing-wallet').click();
  await popup.getByTestId('seed-paste').fill(MNEMONIC);
  await popup.getByTestId('seed-import-submit').click();
  await popup.getByTestId('password-input').fill(PASSWORD);
  await popup.getByTestId('password-confirm').fill(PASSWORD);
  await popup.getByTestId('password-submit').click();
  await popup.getByTestId('open-receive').waitFor({ timeout: 60_000 });

  // Home, once balances and prices have settled.
  await sleep(9000);
  await shot(popup, 'home');

  // Receive.
  await popup.getByTestId('open-receive').click();
  await shot(popup, 'receive');
  await popup.keyboard.press('Escape');
  await sleep(400);

  // Send, filled in to the Review step.
  await popup.getByTestId('open-send').click();
  await popup.getByTestId('send-recipient').fill('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  await popup.getByTestId('send-amount').fill('0.05');
  await popup.getByTestId('send-ack').check();
  await popup.getByTestId('send-continue').click();
  await popup.getByTestId('send-review').waitFor({ timeout: 30_000 });
  await sleep(3500);
  await shot(popup, 'send-review');
  await popup.keyboard.press('Escape');
  await sleep(400);

  // Activity.
  await popup.getByTestId('nav-activity').click();
  await sleep(9000);
  await shot(popup, 'activity');

  // Collectibles.
  await popup.getByTestId('nav-nfts').click();
  await sleep(7000);
  await shot(popup, 'nfts');

  await popup.getByTestId('nav-home').click();
  await sleep(800);

  // Settings.
  await popup.getByTestId('open-settings').click();
  await sleep(1500);
  await shot(popup, 'settings');
  await popup.getByTestId('open-settings').click();
  await sleep(500);

  // Unlock screen.
  await popup.getByLabel('Lock wallet').click();
  await popup.getByTestId('unlock-password').waitFor();
  await sleep(600);
  await shot(popup, 'unlock');
  await popup.getByTestId('unlock-password').fill(PASSWORD);
  await popup.getByTestId('unlock-submit').click();
  await popup.getByTestId('open-receive').waitFor({ timeout: 60_000 });

  // Approval, driven by the test dApp. Signs nothing: the request is rejected.
  const dapp = await context.newPage();
  await dapp.goto('http://localhost:5174/');
  await dapp.locator('#log').waitFor();
  await sleep(1200);

  const findApproval = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      for (const p of context.pages()) if (p.url().includes('approve.html')) return p;
      await sleep(150);
    }
    throw new Error('no approval window opened');
  };

  await dapp.locator('#connect').click();
  let approval = await findApproval();
  await approval.setViewportSize(POPUP);
  await sleep(1500);
  await shot(approval, 'approve-connect');
  await approval.getByTestId('approval-approve').click();
  await sleep(2500);

  await dapp.locator('#signTx').click();
  approval = await findApproval();
  await approval.setViewportSize(POPUP);
  await approval.getByTestId('approval-approve').waitFor({ state: 'visible', timeout: 45_000 });
  await sleep(6000); // let the simulation and the balance diff land
  await shot(approval, 'approve-sign');
  await approval.getByTestId('approval-reject').click();

  await context.close();
  console.log('raw captures written to', raw);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
