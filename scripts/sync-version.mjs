/**
 * Copy `package.json`'s version into the built manifest.
 *
 * The repo keeps a version literal in `manifest.json` too (a unit test asserts
 * the two agree, so a reader of the tree sees the real number), but the zip's
 * version is the one Chrome shows and the store submits against. This makes
 * `package.json` the single source of truth for it at build time: bump there
 * and the build cannot ship a stale manifest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(repo, process.env.CINDER_OUT_DIR ?? 'dist');
const manifestPath = path.join(outDir, 'manifest.json');

const { version } = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== version) {
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`sync-version: ${path.relative(repo, manifestPath)} is ${version}`);
