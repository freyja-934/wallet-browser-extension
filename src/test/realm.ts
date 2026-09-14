/**
 * jsdom gives the page its own realm, with its own `Uint8Array`. Under vitest
 * `@solana/web3.js` is loaded as a Node dependency, so the `Buffer` it builds
 * program-address seeds with is Node's — and a Node `Buffer` is not `instanceof`
 * jsdom's `Uint8Array`. `@noble/hashes` checks exactly that, so every
 * `findProgramAddressSync` in a jsdom test fails with "Uint8Array expected",
 * which surfaces as `Unable to find a viable program address nonce`.
 *
 * The popup's real runtime has one realm and the `buffer` polyfill, whose Buffer
 * is a genuine `Uint8Array` subclass, so this is an artifact of the test
 * environment and not of the code under test. The fix is additive on purpose:
 * widening `instanceof` to a realm-independent brand check, rather than swapping
 * the global, which would break the libraries that are checking against jsdom's
 * `Uint8Array` correctly.
 *
 * Call it from a jsdom test that exercises an associated-token-address
 * derivation — the keyless token list reads the wallet's own token account per
 * mint, so it derives one for every row.
 *
 * Not a test file itself: `test.include` only collects `*.test.{ts,tsx}`.
 */
export function acceptCrossRealmUint8Arrays(): void {
  Object.defineProperty(Uint8Array, Symbol.hasInstance, {
    configurable: true,
    value: (value: unknown) => Object.prototype.toString.call(value) === '[object Uint8Array]',
  });
}
