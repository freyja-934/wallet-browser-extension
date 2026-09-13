/**
 * Copy the legal pages that ship inside the extension (`public/legal/*.html`)
 * to the GitHub Pages tree (`docs/legal/*.html`).
 *
 * The Chrome Web Store listing needs a privacy policy at a URL the reviewer can
 * open. Pages serves this repo from `/docs` on `main`, and Jekyll copies an HTML
 * file without front matter through verbatim — so `docs/legal/privacy.html` is
 * published at `…/legal/privacy.html`, which is the URL in `docs/store/listing.md`.
 * A Markdown file without front matter is *not* converted, so the `.md` copies
 * next to these are the readable source for humans, not the published page.
 *
 * Run `node scripts/sync-legal.mjs` after editing anything under `public/legal/`.
 * `src/config/legal.test.ts` fails if the two trees drift.
 */
import { copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(repo, 'public', 'legal');
const to = path.join(repo, 'docs', 'legal');

const pages = readdirSync(from).filter((name) => name.endsWith('.html'));
for (const name of pages) {
  copyFileSync(path.join(from, name), path.join(to, name));
  console.log(`sync-legal: docs/legal/${name} <- public/legal/${name}`);
}
