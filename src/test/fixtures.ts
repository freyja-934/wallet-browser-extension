/**
 * Public BIP39 test vector (`abandon` x 11 + `about`). Not a secret; see docs/test-wallet.md.
 * Mirrors `e2e/popup.ts`; unit tests must not import from `e2e/`.
 */
export const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const TEST_PASSWORD = 'TestWallet1!';
export const TEST_ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
