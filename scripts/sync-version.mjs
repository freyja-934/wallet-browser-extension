/**
 * Copy `package.json`'s version into the built manifest.
 *
 * The repo keeps a version literal in `manifest.json` too (a unit test asserts
 * the two agree, so a reader of the tree sees the real number), but the zip's
 * version is the one Chrome shows and the store submits against. This makes
 * `package.json` the single source of truth for it at build time: bump there
 * and the build cannot ship a stale manifest.
 *
 * Two things it refuses rather than doing quietly, because both end as a
 * rejected or unpublishable upload:
 *
 * - a version Chrome will not parse. `version` must be one to four integers
 *   separated by dots, each 0-65535 and without a leading zero — no `-beta`,
 *   no `1.0.0-rc.1`, which npm is perfectly happy with.
 * - a *lower* version than the manifest already carries. The Chrome Web Store
 *   only accepts an upload whose version is higher than the published one, so
 *   overwriting 0.4.0 with 0.3.0 because someone forgot to bump `package.json`
 *   would produce a zip that is rejected on submission.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `||`, not `??`: `CINDER_OUT_DIR=` set but empty must not resolve to the repo root.
const outDir = path.resolve(repo, process.env.CINDER_OUT_DIR || 'dist');
const manifestPath = path.join(outDir, 'manifest.json');

/** Repo-relative when it is inside the repo, absolute when `CINDER_OUT_DIR` points elsewhere. */
function rel(target) {
  const relative = path.relative(repo, target);
  return relative.startsWith('..') ? target : relative;
}

function fail(message) {
  console.error(`sync-version: ${message}`);
  process.exit(1);
}

/** Chrome's rule: 1-4 dot-separated integers, 0-65535, no leading zeros. */
function parseVersion(value, where) {
  if (typeof value !== 'string') fail(`${where} has no version string.`);
  const parts = value.split('.');
  if (parts.length < 1 || parts.length > 4) {
    fail(`${where} version "${value}" has ${parts.length} parts; Chrome allows one to four.`);
  }
  return parts.map((part) => {
    if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) > 65535) {
      fail(
        `${where} version "${value}" is not a manifest version: every part must be an integer 0-65535 with no leading zero, no suffix such as "-beta".`,
      );
    }
    return Number(part);
  });
}

/** -1, 0 or 1, comparing part by part; a missing part counts as 0 (`1.2` === `1.2.0`). */
function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

const { version } = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const wanted = parseVersion(version, 'package.json');
const current = parseVersion(manifest.version, rel(manifestPath));

if (compareVersions(wanted, current) < 0) {
  fail(
    `refusing to write ${rel(manifestPath)}: package.json is ${version}, ` +
      `which is lower than the manifest's ${manifest.version}. The Chrome Web Store rejects an ` +
      'upload that does not raise the version — bump package.json (and manifest.json with it).',
  );
}

if (manifest.version !== version) {
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`sync-version: ${rel(manifestPath)} is ${version}`);
