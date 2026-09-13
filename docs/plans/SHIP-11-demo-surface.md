# SHIP-11 — Demo surface: the five things a screenshot pass exposed

## Goal

Five defects found while capturing Chrome Web Store screenshots, each visible to
anyone who opens the extension or the example dApp. None changes a grant, a key,
or the message API: they are an unreachable endpoint, an unreadable error, an
empty approval screen, six tests that blame the product for an empty fixture, and
a fixture whose real state is written down nowhere.

## Context

Two facts about the public fixture `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk`,
both reproduced on 2026-09-13 and taken as given here:

- **Mainnet:** the account is owned by program `9G4pPipvCwQkf2X3CtFFJgK88vdN43EoKn7Kf8wxjKa`,
  not the system program — somebody used the public mnemonic to `assign` it. It holds
  2.11 SOL and reads fine, but the runtime refuses it as fee payer with
  `InvalidAccountForFee` before execution. It can never pay a mainnet fee again.
- **Devnet:** a normal system account, repeatedly swept to zero by bots. The faucet
  is rate-limited by address *and* by IP, so it cannot be topped up programmatically.

## Steps

1. The example dApp cannot reach mainnet. Files: `examples/test-dapp/main.js`.
   `api.mainnet-beta.solana.com` 403s every browser request — the finding this project
   started from, still shipped in our own example. Point mainnet at
   `https://solana-rpc.publicnode.com` (the wallet's own default) and log the
   dummy-blockhash fallback in the dApp's log instead of silently producing something
   that looks live.
   Verify: `just check`

2. A string simulation error renders with literal quotes (`"InvalidAccountForFee"`).
   Files: `src/lib/preview.ts`, `src/lib/preview.test.ts`.
   `JSON.stringify` of a string keeps the quotes. Render strings as-is, map the common
   runtime errors to a plain-English sentence, keep the raw code alongside.
   Verify: `just check`

3. The Connect approval is nearly empty. Files: `src/components/transactions/ApprovalScreen.tsx`,
   `e2e/dapp.spec.ts`. Show which account is shared, the active cluster, and what
   connecting does and does not permit. Presentation only: every `data-testid` and the
   button behaviour stay as they are.
   Verify: `just check`, `just e2e e2e/dapp.spec.ts`

4. An unfunded fixture must not masquerade as a product failure. Files: `e2e/devnet.ts`,
   `e2e/send.spec.ts`, `e2e/dapp.spec.ts`, `README.md`, `AGENTS.md`. Read the balance once
   as a precondition and skip — never soften — the tests that need funds, naming the
   address, the balance, the shortfall and the faucet.
   Verify: `just e2e`

5. Record the fixture's real state. Files: `docs/test-wallet.md`, `AGENTS.md`.
   Verify: `just check`

## Out of scope

- Topping up the fixture, or replacing it with a generated key.
- Any change to the grant a connect approval makes, the Wallet Standard surface, or
  the message API.
- Retries or weakened assertions in e2e.

## Risks

- Skipping on an empty fixture can hide a real regression in the send path. Mitigated by
  the skip message naming the shortfall, and by every test staying fully active when the
  wallet is funded.

## Parking lot

- A mainnet demo needs a freshly generated throwaway key; the public fixture cannot sign
  a mainnet fee any more.
