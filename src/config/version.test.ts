import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import pkg from '../../package.json';
import { WALLET_VERSION } from './constants';

/**
 * The built manifest's version comes from `package.json` (`scripts/sync-version.mjs`,
 * run by `copy:manifest`), so the zip is never stale. The `manifest.json` checked
 * into the repo still carries its own literal — that is the number a reader of the
 * tree, a reviewer of a diff, and `just store`'s guards see — and nothing at build
 * time writes it back. This is what stops the two drifting: bump both together.
 */
describe('the shipped version', () => {
  it('is the same in package.json and manifest.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('is what the popup shows', () => {
    expect(WALLET_VERSION).toBe(manifest.version);
  });
});
