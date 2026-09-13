/**
 * Compose the Chrome Web Store listing images from the raw popup captures.
 *
 *   node scripts/compose-store-images.mjs
 *
 * Reads docs/store/screenshots/raw/*.png (written by capture-screenshots.mjs)
 * and writes the numbered 1280x800 shots plus the two promo tiles beside them.
 * Rendering is done in the same Chromium Playwright already provides, so this
 * needs no image library.
 */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(repo, 'docs/store/screenshots');
const raw = path.join(shots, 'raw');

/** The listing, in order. Each caption says what the shot proves, not what it is. */
const SLIDES = [
  { file: 'home', out: '01-home', title: 'Your balance, priced live',
    body: 'Real holdings from the chain, with prices. A read that fails says so — it never shows a zero it does not know.' },
  { file: 'approve-sign', out: '02-approve',
    title: 'See the balance change before you sign',
    body: 'Every request is simulated against the network first, and the result is shown as an exact before-and-after, network fee included. What cannot be simulated is not quietly signed.' },
  { file: 'approve-connect', out: '03-connect', title: 'Consent in plain language',
    body: 'A site sees only the address you share, and every signature is approved separately. Connected sites are listed in Settings, and revocable.' },
  { file: 'send-review', out: '04-send', title: 'A real fee, and the whole address',
    body: 'The fee is quoted by the network, not guessed. Amounts are integer units end to end, so what you type is what is sent.' },
  { file: 'tokens', out: '05-tokens', title: 'Named, or honestly unnamed',
    body: 'Symbols and icons come from on-chain metadata. When a mint publishes none, the wallet shows the mint address and a copy button rather than inventing a label.' },
];

const EXTRAS = [
  { file: 'activity', out: 'extra-activity', title: 'Activity, read from the chain',
    body: 'Transfers in and out, paged on demand.' },
  { file: 'receive', out: 'extra-receive', title: 'Receive', body: 'Your address, as a code and as text.' },
  { file: 'settings', out: 'extra-settings', title: 'Your endpoint, your choice',
    body: 'Point the wallet at any RPC you trust. It is checked before it is saved.' },
];

const FONTS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

function slideHtml(dataUri, title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1280px;height:800px;background:#010000;font-family:${FONTS};overflow:hidden;
      display:flex;align-items:center;gap:72px;padding:0 88px;position:relative}
    .glow{position:absolute;width:900px;height:900px;border-radius:50%;right:-280px;top:-300px;
      background:radial-gradient(circle,rgba(255,123,22,.20),rgba(255,123,22,0) 62%);filter:blur(10px)}
    .glow2{position:absolute;width:620px;height:620px;border-radius:50%;left:-220px;bottom:-260px;
      background:radial-gradient(circle,rgba(209,103,31,.14),rgba(0,0,0,0) 65%)}
    .copy{flex:1;position:relative;z-index:2;max-width:560px}
    .mark{display:flex;align-items:center;gap:12px;margin-bottom:30px}
    .sq{width:26px;height:26px;border-radius:8px;border:2.5px solid #ff7b16;box-shadow:0 0 18px rgba(255,123,22,.55)}
    .brand{color:#ebeae9;font-size:15px;letter-spacing:.22em;text-transform:uppercase;font-weight:600}
    h1{color:#fff;font-size:52px;line-height:1.08;letter-spacing:-.022em;font-weight:650;margin-bottom:24px}
    p{color:#a5a19e;font-size:21px;line-height:1.5;font-weight:400}
    .shot{position:relative;z-index:2;flex-shrink:0}
    .shot img{width:380px;height:600px;display:block;border-radius:22px;
      box-shadow:0 34px 90px rgba(0,0,0,.72), 0 0 0 1px rgba(235,234,233,.10)}
  </style></head><body>
    <div class="glow"></div><div class="glow2"></div>
    <div class="copy">
      <div class="mark"><div class="sq"></div><div class="brand">Cinder Wallet</div></div>
      <h1>${title}</h1><p>${body}</p>
    </div>
    <div class="shot"><img src="${dataUri}"></div>
  </body></html>`;
}

function promoHtml(width, height, dataUri, big) {
  const pad = big ? 78 : 30;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${width}px;height:${height}px;background:#010000;font-family:${FONTS};overflow:hidden;
      display:flex;align-items:center;gap:${big ? 64 : 22}px;padding:0 ${pad}px;position:relative}
    .glow{position:absolute;width:${big ? 780 : 320}px;height:${big ? 780 : 320}px;border-radius:50%;
      right:${big ? -200 : -90}px;top:${big ? -240 : -110}px;
      background:radial-gradient(circle,rgba(255,123,22,.24),rgba(255,123,22,0) 62%)}
    .copy{flex:1;position:relative;z-index:2}
    .mark{display:flex;align-items:center;gap:${big ? 14 : 8}px;margin-bottom:${big ? 22 : 10}px}
    .sq{width:${big ? 30 : 15}px;height:${big ? 30 : 15}px;border-radius:${big ? 9 : 5}px;
      border:${big ? 3 : 2}px solid #ff7b16;box-shadow:0 0 18px rgba(255,123,22,.55)}
    .brand{color:#ebeae9;font-size:${big ? 17 : 10}px;letter-spacing:.22em;text-transform:uppercase;font-weight:600}
    h1{color:#fff;font-size:${big ? 60 : 25}px;line-height:1.06;letter-spacing:-.022em;font-weight:650;
      margin-bottom:${big ? 18 : 7}px}
    p{color:#a5a19e;font-size:${big ? 23 : 11.5}px;line-height:1.42}
    .shot{position:relative;z-index:2;flex-shrink:0}
    .shot img{width:${big ? 290 : 132}px;height:${big ? 458 : 208}px;display:block;
      border-radius:${big ? 18 : 9}px;box-shadow:0 26px 70px rgba(0,0,0,.72), 0 0 0 1px rgba(235,234,233,.10)}
  </style></head><body>
    <div class="glow"></div>
    <div class="copy">
      <div class="mark"><div class="sq"></div><div class="brand">Cinder Wallet</div></div>
      <h1>A Solana wallet<br>that shows its work</h1>
      <p>Simulated previews, per-site consent, and an honest answer when the chain will not talk.</p>
    </div>
    <div class="shot"><img src="${dataUri}"></div>
  </body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  const uri = async (name) =>
    `data:image/png;base64,${(await readFile(path.join(raw, `${name}.png`))).toString('base64')}`;

  const render = async (html, width, height, out) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shots, out) });
    await page.close();
    console.log('wrote', out);
  };

  for (const s of [...SLIDES, ...EXTRAS]) {
    await render(slideHtml(await uri(s.file), s.title, s.body), 1280, 800, `${s.out}-1280x800.png`);
  }
  await render(promoHtml(1400, 560, await uri('approve-sign'), true), 1400, 560, 'promo-marquee-1400x560.png');
  await render(promoHtml(440, 280, await uri('approve-sign'), false), 440, 280, 'promo-small-440x280.png');

  await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
