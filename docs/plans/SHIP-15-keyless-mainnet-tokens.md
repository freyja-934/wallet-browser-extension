# SHIP-15 — Keyless mainnet tokens

## Goal

A user who installs from the Chrome Web Store and configures nothing sees their mainnet
SPL and Token-2022 balances, with names, symbols and logos. Today they see SOL only,
because no keyless RPC will enumerate token accounts.

NFTs stay unavailable keyless. That gap is real, has no acceptable source, and should be
stated rather than closed badly.

## Context

Measured on 2026-09-14, every claim from a real `chrome-extension://` page, because curl
does not enforce CORS and reports endpoints as working that a browser refuses.

- `api.mainnet-beta.solana.com` answers 200 to a request with no `Origin` header and 403
  to the identical request with one. Every extension request carries one, from the popup
  and from the service worker alike. It can never serve this wallet.
- `solana-rpc.publicnode.com` (Allnodes) serves `getBalance`, `getSignaturesForAddress`,
  `getLatestBlockhash`, `getAccountInfo` and `getMultipleAccounts`, and refuses
  `getTokenAccountsByOwner` with `-32602 Request blocked` and DAS `getAssetsByOwner` with
  `-32601`. Its own error text says indexed requests need a personal token.
- `getMultipleAccounts` on publicnode is capped at 10 accounts per call, measured; 11
  fails, and an over-cap call stalls about 3 seconds before erroring.
- **Jupiter's free public API works keyless from an extension origin.** Verified twice
  independently: `GET https://lite-api.jup.ag/ultra/v1/balances/{owner}` returned 1 entry
  for the public fixture (SOL only, correct) and 4,198 for Binance's hot wallet, with
  `access-control-allow-origin` echoing the extension origin.
  `GET https://lite-api.jup.ag/tokens/v2/search?query=<up to 100 mints>` returns name,
  symbol and icon; 100 mints in about 200 ms.
- No keyless DAS exists. Metaplex retired the free Aura endpoints and the hostnames are
  NXDOMAIN on public resolvers.

Two alternatives were measured and rejected, and the reasons belong in the ADR:

- **Derive each associated token address from a curated mint list and read it.** Needs no
  third party at all, which is why it was the first choice. It cannot see a balance held
  in a non-canonical token account: on a real seven-account wallet it missed two of seven,
  including a wrapped-SOL account holding 227 SOL. A wallet that silently omits a real
  holding is worse than one that says it cannot enumerate.
- **Solana Vibe Station and ZAN**, the two keyless RPCs that do serve
  `getTokenAccountsByOwner`. Both throttle below the wallet's normal request pattern
  (three concurrent is a hard cap on one; the other loses 3-5 of 6 parallel calls), and
  both providers' own documentation excludes this use.

## Steps

1. **Endpoints and the gate.**
   Files: `src/config/constants.ts`.
   Add the two Jupiter URLs with a doc comment in the register of the existing
   `PUBLIC_MAINNET_RPCS` block: what was measured, from where, on what date. Export
   `jupiterEnabledFor(cluster, settings)`, false on devnet and false whenever
   `settings.rpcUrl` or `settings.heliusApiKey` is set. A user who configured an endpoint
   must never have their address sent to Jupiter.
   Verify: `just check`

2. **The service.**
   Files: `src/services/jupiter.ts` (new), `src/services/jupiter.test.ts` (new).
   `fetchJupiterBalances(address, signal)` and `fetchJupiterTokenInfo(mints, signal)`.
   Treat both response bodies as untrusted, exactly as `HeliusEnhancedTransaction` is
   treated in `helius.ts`: every field `unknown` and validated, unknown fields ignored.
   `credentials: 'omit'`, an AbortController timeout, a response-size guard (528 KB is a
   realistic worst case), and chunking of the search call at 100 mints. Neither function
   may throw past its caller; a failure degrades to today's empty state.
   Verify: `just check`

3. **Wire it into the one branch that already exists.**
   Files: `src/services/helius.ts`.
   Where `tokensError` is set to `TOKENS_UNAVAILABLE`, call the Jupiter path when
   `jupiterEnabledFor` passes. Then **confirm `decimals` on-chain** for every mint via
   `getMultipleAccounts` through the existing rotated connection, batched at 10. Drop any
   mint whose decimals could not be confirmed rather than inferring them. Add
   `tokensSource?: 'rpc' | 'jupiter'` to `TokenBalances`; keep `tokensError` set when
   Jupiter also fails.
   **This is the load-bearing rule of the whole phase: Jupiter supplies discovery and
   cosmetics. Every number the user acts on is read from the chain.** `SendModal` feeds
   the displayed decimals into the smallest-unit conversion, so a wrong value there is a
   wrong send amount.
   Verify: `just check`

4. **Make `tokenAccount` optional end to end.**
   Files: `src/services/helius.ts`, `src/components/tokens/TokenList.tsx`,
   `src/components/tokens/SendModal.tsx`, and the slices that carry the type.
   Jupiter returns a mint and an amount, not an account address. Key the list and the send
   selector off `mint`. Omit `source` for a Jupiter-sourced token; `transfers.ts` already
   falls back to `getAssociatedTokenAddressSync`, which is the right derivation. Accept and
   surface the known limitation: a balance in a non-canonical account will display and then
   fail at send with "source not found" rather than sending from the wrong account.
   Verify: `just check`

5. **Say where the numbers came from.**
   Files: `src/components/tokens/TokenList.tsx`, the NFT empty state.
   When `tokensSource === 'jupiter'`, a quiet line under the list: the token list came from
   Jupiter, the balances and amounts were read from the chain. Same plainness as the
   existing unavailable states. Make the NFT empty state say explicitly that collectibles
   need a user-supplied endpoint on mainnet because no keyless source exists.
   Logos render with `<img src>` straight from the returned https URL; the CSP already
   allows `img-src https:` and `<img>` is not CORS-restricted, so no fetch. Rewrite
   `ipfs://` to a gateway that is not ipfs.io, which 403s an extension origin.
   Verify: `just check`

6. **Rotation: document what exists, and note what does not.**
   Files: `src/config/constants.ts`, `README.md`.
   `src/lib/rpc-rotate.ts` already implements cooldowns, health marking and reordering,
   with 46 tests, and the services already rotate through the list. The gap is not the
   mechanism, it is that mainnet's public list has exactly one entry, so there is nothing
   to fail over to. Say that plainly next to the list rather than leaving a reader to
   assume failover exists where it cannot. Do not add a second RPC host in this phase;
   that is a data-recipient decision for the owner, and the measured candidates and their
   throttling are recorded in the ADR.
   Verify: `just check`

7. **Tests that would fail without the change.**
   Files: `src/services/jupiter.test.ts`, `src/services/helius.test.ts`,
   `scripts/probe-mainnet-rpcs.mjs`.
   Cover: a whale-shaped payload, an empty wallet, malformed and truncated JSON, non-200
   and timeout, none of which may throw past the service. Jupiter IS called when the token
   method returns `-32602` on mainnet with only public URLs, and is NOT called on devnet,
   NOT when `rpcUrl` is set, NOT when `heliusApiKey` is set, and NOT when the RPC token
   call succeeded. A mint whose on-chain decimals could not be confirmed never reaches the
   send selector. Add the two Jupiter URLs to the probe script so the reachability claim
   stays re-verifiable from a real extension origin.
   Verify: `just check`, then `just e2e`

8. **Docs and disclosure.**
   Files: `docs/adr/0004-keyless-token-discovery.md` (new), `public/legal/privacy.html`
   then `node scripts/sync-legal.mjs`, `README.md`, `CHANGELOG.md`,
   `docs/store/listing.md`.
   The ADR records what was measured, what was rejected and why, in the voice of 0002 and
   0003. The privacy policy must name `lite-api.jup.ag` as a host that receives the user's
   address when no endpoint is configured; `src/config/legal.test.ts` fails if the
   published and shipped copies drift. Update the listing's description, which currently
   tells a store reviewer that mainnet tokens need a user-supplied endpoint.
   Verify: `just check`

## Out of scope

- **NFTs.** No keyless source is good enough. Magic Eden's marketplace index is the only
  candidate and a wallet asserting ownership on one marketplace's authority is a different
  trust class from reading a balance. Leave the honest empty state.
- **Adding a second public RPC host.** A data-recipient decision for the owner.
- **Any proxy or server.** The calls that need a credential are the address-keyed ones, so
  there is no privacy-cheap half to proxy.
- Enriched transaction history.

## Risks

- **Wrong decimals send the wrong amount.** This is the one that can lose money. Decimals
  must come from the mint account, never from Jupiter. A test must prove it.
- **A third party with no SLA.** Jupiter can rate-limit, change shape or vanish. It is
  fallback-only, so the failure mode is exactly today's behaviour. Nothing in signing,
  sending, history or dApp connection may depend on it.
- **Privacy.** Jupiter receives the user's address and IP when no endpoint is configured.
  That is a real regression and must be disclosed, not buried.
- **Untrusted JSON.** Validate every field. A hostile or broken response must not reach
  the UI or the send path.

## Parking lot

- An opt-in NFT source, named in the interface.
- A second mainnet RPC for failover, with the throttling measured in the ADR.
