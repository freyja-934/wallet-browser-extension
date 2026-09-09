# Local test wallet (public fixture)

This is the BIP39 test vector `abandon` × 11 + `about`. It is not a secret. Anyone can derive it. Do not send mainnet funds you care about.

Use this for Playwright, Load unpacked, and faucet/airdrop on **devnet** (`VITE_NETWORK=devnet`).

| Field | Value |
|---|---|
| Mnemonic | `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about` |
| Password | `TestWallet1!` |
| First account | `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk` |
| Path | `m/44'/501'/0'/0'` |

Same constants live in `e2e/popup.ts` as `TEST_MNEMONIC` / `TEST_PASSWORD`.

The extension must never `console.log` this phrase. Docs and e2e fixtures may store it.
