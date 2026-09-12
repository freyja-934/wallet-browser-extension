import { Buffer } from 'buffer';

/**
 * Side-effect module: make `Buffer` a global before any chain library evaluates.
 * `@solana/spl-token-metadata` (pulled in by `getTokenMetadata`) calls
 * `Buffer.from` at module top level, and static imports are hoisted above the
 * entry's own statements, so an assignment in `main.tsx`'s body runs too late.
 * Import this first in every browser entry that reaches chain code.
 */
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
