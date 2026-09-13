# Local test wallet (public fixture)

This is the BIP39 test vector `abandon` × 11 + `about`. It is not a secret. Anyone can derive it. Do not send mainnet funds you care about.

Use this for Playwright, Load unpacked, and faucet/airdrop on **devnet** (`VITE_NETWORK=devnet`).

| Field | Value |
|---|---|
| Mnemonic | `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about` |
| Password | `TestWallet1!` |
| First account | `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk` |
| Path | `m/44'/501'/0'/0'` |

Same constants live in `e2e/popup.ts` as `TEST_MNEMONIC` / `TEST_PASSWORD`, and in `src/test/fixtures.ts` for unit tests (which must not import from `e2e/`).

The extension must never `console.log` this phrase. Docs and e2e fixtures may store it.

## Cost of a test run

A full `just e2e` spends 10000 lamports from the fixture (two fee-only self-transfers on devnet: the dApp `signAndSend` approval and the popup send test). Funds never leave the fixture address; top it up at https://faucet.solana.com when it runs low.
