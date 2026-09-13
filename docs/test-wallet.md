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

## State of this address, checked 2026-09-13

This is a public BIP39 fixture: the mnemonic is in every wordlist example, so anyone can
derive it and anyone does. Two consequences, both verified on 2026-09-13:

- **Mainnet: read-only, permanently.** The account is owned by program
  `9G4pPipvCwQkf2X3CtFFJgK88vdN43EoKn7Kf8wxjKa`, not the system program — somebody used the
  public mnemonic to `assign` it. It holds 2.11 SOL and reads fine, but the runtime rejects it
  as fee payer with `InvalidAccountForFee` before execution. It can never pay a mainnet fee
  again, so mainnet runs against this address are read-only: balances, history, previews.
- **Devnet: funded only until the next sweep.** There it is a normal system account, and bots
  drain it to zero repeatedly (last observed drain: 08:40 on 2026-09-13). The RPC faucet is
  rate-limited by address *and* by IP, so it cannot be topped up from a script — do it by hand
  at https://faucet.solana.com before a full `just e2e`.

A demo that needs a **mainnet signature** must use a freshly generated throwaway key, funded
with an amount you are willing to lose. This address cannot produce one.

`just e2e` treats an empty fixture as a faucet fact, not a wallet bug: the six tests that need
funds skip with the balance and the shortfall, everything else runs. See `e2e/devnet.ts`.

## Cost of a test run

A full `just e2e` spends 10000 lamports from the fixture (two fee-only self-transfers on devnet: the dApp `signAndSend` approval and the popup send test). Funds never leave the fixture address; top it up at https://faucet.solana.com when it runs low.
