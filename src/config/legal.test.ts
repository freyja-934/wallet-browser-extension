import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shipped = path.join(repo, 'public', 'legal');
const published = path.join(repo, 'docs', 'legal');

/**
 * Two copies of the same page: `public/legal/*.html` is what the extension
 * shows (Settings → Privacy policy), `docs/legal/*.html` is what GitHub Pages
 * serves at the URL the Chrome Web Store listing gives the reviewer. A store
 * review reads the published copy, so the two must not drift.
 *
 * `node scripts/sync-legal.mjs` regenerates the published copy from the shipped
 * one; this test is what makes forgetting to run it a red build.
 */
describe('the legal pages', () => {
  const pages = readdirSync(shipped).filter((name) => name.endsWith('.html'));

  it('are all published to docs/ for GitHub Pages', () => {
    expect(pages).toContain('privacy.html');
    expect(readdirSync(published).filter((name) => name.endsWith('.html')).sort()).toEqual(
      [...pages].sort(),
    );
  });

  it.each(pages)('%s is byte-identical in public/legal and docs/legal', (name) => {
    const inExtension = readFileSync(path.join(shipped, name), 'utf8');
    const onPages = readFileSync(path.join(published, name), 'utf8');
    expect(onPages, `docs/legal/${name} is stale — run: node scripts/sync-legal.mjs`).toBe(
      inExtension,
    );
  });
});
