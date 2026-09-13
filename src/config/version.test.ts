import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import pkg from '../../package.json';
import { WALLET_VERSION } from './constants';

/**
 * `manifest.json` carries its own version literal and nothing at build time
 * copies `package.json`'s into it, so the store listing and the popup's About
 * line can drift apart silently. This is what stops that: bump both together.
 */
describe('the shipped version', () => {
  it('is the same in package.json and manifest.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('is what the popup shows', () => {
    expect(WALLET_VERSION).toBe(manifest.version);
  });
});
