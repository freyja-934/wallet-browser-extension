# ADR 0004 — Keyless token discovery: Jupiter for the list, the chain for the numbers

## Context

ADR 0003 settled which keyless Mainnet endpoint a store install talks to, and
accepted a consequence: keyless Mainnet is SOL-only. `solana-rpc.publicnode.com`
serves `getBalance`, `getSignaturesForAddress`, `getLatestBlockhash`,
`getAccountInfo` and `getMultipleAccounts`, and refuses the two calls that would
list a wallet's holdings — `getTokenAccountsByOwner` with `-32602 Request blocked`,
and DAS `getAssetsByOwner` with `-32601`. Its own error text says indexed requests
need a personal token.

So a user who installs from the Chrome Web Store and configures nothing sees SOL
and nothing else, while holding tokens the chain plainly knows about. That is the
gap this ADR closes, and it closes only half of it: tokens, not NFTs.

Everything below was measured on 2026-09-14 from a real `chrome-extension://`
page, never from curl, for the reason ADR 0003 gives: curl does not enforce CORS
and reports endpoints as working that a browser refuses.

## Options considered

1. **Derive each associated token address from a curated mint list and read those
   accounts.** No third party at all, which is why it was the first choice. It
   fails on correctness: an associated token address is only the *canonical*
   account for a mint, and a wallet may hold a balance in a non-canonical one. On
   a real seven-account wallet it missed two of seven, including a wrapped-SOL
   account holding 227 SOL. A wallet that silently omits a real holding is worse
   than one that says it cannot enumerate.
2. **Another keyless RPC that does serve `getTokenAccountsByOwner`.** Two exist:
   Solana Vibe Station and ZAN. Both throttle below this wallet's normal request
   pattern — three concurrent is a hard cap on one, and the other lost three to
   five of six parallel calls — and both providers' own documentation excludes
   this use. Adding either would also put a second host on the list of parties
   that receive the addresses a user looks up, which ADR 0003 treats as a
   data-recipient decision rather than a free redundancy win.
3. **A proxy of our own.** The calls that need a credential are exactly the
   address-keyed ones, so there is no privacy-cheap half to proxy: a proxy would
   see every address anyway, and it would be a backend this project does not run.
4. **Jupiter's free public API for discovery, the chain for every number**
   (chosen).

## Decision

`https://lite-api.jup.ag` supplies **discovery and cosmetics only**: which mints an
address holds, and their names, symbols and logos. Every number a user acts on is
read from the chain.

- `GET /ultra/v1/balances/{owner}` returns an object keyed by mint. Verified twice
  independently from an extension origin: 1 entry for the public fixture (SOL only,
  correct) and 4,023 for an exchange hot wallet, about 460 KB, with
  `access-control-allow-origin` echoing the extension origin.
- `GET /tokens/v2/search?query=<up to 100 mints>` returns name, symbol and icon;
  100 mints in about 200 ms.
- Then, for every mint discovered, **`getMultipleAccounts` on the mint accounts
  themselves**, through the existing rotated connection, for `decimals` and the
  owning token program. Batched at ten: publicnode caps that method at 10 accounts,
  measured — ten answered in 195 ms, eleven stalled 3.1 s and then failed with
  `Request blocked`.
- Then, for every mint that confirmed, **`getMultipleAccounts` on the owner's
  associated token accounts**, derived under each mint's own program, for the
  amount each one holds. Same rotated connection, same batches of ten.

The load-bearing rule, and the reason those two reads exist at all: every number the
user acts on is a number this wallet read from the chain.

- `decimals`, because `SendModal` feeds the decimals it displays into the
  smallest-unit conversion — decimals taken on trust from a third party would be a
  wrong send amount. `src/services/helius.test.ts` holds it with a test where
  Jupiter states 2 decimals and the mint account says 6.
- the **amount**, because it is what the row shows, what Max fills in, and what the
  insufficient-balance check is made against. Jupiter's `ultra/v1/balances` is keyed
  by mint, so its figure is the wallet-level total across every account of that mint;
  a row with no `source` sends from the associated account, which may hold less or
  nothing. The amount shown is what that account holds, so what the list offers and
  what a send can move are the same number by construction. Jupiter's own amount is
  used for one thing only: deciding which mints are worth asking the chain about.

A holding neither read confirms is **dropped, not guessed**, and the count of what
was dropped is printed under the list rather than hidden — counted apart from the
per-refresh cap, because "we did not ask" and "the chain would not confirm it" are
different news and only one of them is the user's to act on.

The gate is `jupiterEnabledFor(cluster, settings)`: Mainnet only, and only when the
user has configured neither a custom RPC URL nor a Helius key. A user who named an
endpoint chose where their address goes, and that choice is never widened quietly.

One refresh confirms at most `JUPITER_MAX_TOKENS` (200) mints — forty round trips
through the single keyless host, twenty for the mints and twenty for the token
accounts. A hot wallet holding four thousand mints is real, and asking eight hundred
times is not something a popup may do to a free endpoint.

The 200 are the first 200 Jupiter returned, in Jupiter's own order. That order is not
a documented contract and is not sorted here: ranking by value would need decimals
for every discovered mint, which is the read the cap exists to avoid, and ranking by
the raw integer amount across unknown decimals compares nothing. So the wallet does
not imply a judgement it did not make — the line under the list says the cap is the
first 200 Jupiter returned, and a large holding can sit past it.

## Consequences

- **Keyless Mainnet now shows SPL and Token-2022 balances**, named and with logos,
  for a store install that configures nothing. NFTs still do not: see below.
- **Jupiter receives the user's address and IP** when no endpoint is configured.
  That is a real privacy regression against SHIP-14's position, and it is disclosed
  in `public/legal/privacy.html` and in the store listing rather than buried. It is
  also avoidable by the user in one step: entering any RPC URL in Settings turns it
  off.
- **A third party with no SLA.** Jupiter can rate-limit, change shape or vanish. It
  is fallback-only and reached only after the RPC path has already failed, so its
  failure mode is exactly the SOL-only state of ADR 0003. Nothing in signing,
  sending, history or dApp connection touches it.
- **A balance held in a non-canonical token account is counted, not shown.** Jupiter
  returns a mint and an amount, not an account address, so a Jupiter-sourced row
  carries no `source` and both the displayed balance and `buildTransfer`'s source are
  the associated token account. When the balance is somewhere else that account is
  absent or empty, the row is dropped and counted under the list. This is option 1's
  limitation, arrived at from the other direction, and it is accepted for the same
  reason the alternative was rejected: the wallet says how many holdings it could not
  confirm rather than showing a number a send could not move. Where a row does reach
  the send screen and its account has since gone, `buildTransfer` reads the derived
  account before building on it and fails with "Token account not found" on Review,
  rather than at preflight as an unlabelled simulation error.
- **Token-2022 transfer fees are not shown, and the rent quote does not size the
  extension.** A `TransferFeeConfig` mint is moved with `createTransferCheckedInstruction`
  like any other, and the program withholds the fee at the destination: Review says
  "send 100" and the recipient can withdraw 99, with nothing on screen about the
  difference. The rent line quotes a bare `ACCOUNT_SIZE` account, while a Token-2022
  destination that needs the `TransferFeeAmount` extension costs more. Both are
  pre-existing — a configured endpoint has always listed Token-2022 balances — but
  this change is what puts them in front of a keyless install, so they are recorded
  here rather than left unsaid. Closing them means reading the mint's TLV in the
  worker and sizing rent with `getAccountLenForMint`.
- **On-chain names need a batch size the endpoint will take.** `fetchTokenMetadata`
  reads Metaplex PDAs 100 keys at a time, which is the JSON-RPC limit and which
  publicnode refuses; a failed Metaplex batch is an endpoint failure there, so it
  would also discard the Token-2022 names already collected. `getTokenNames` passes
  ten when the endpoint list is the public Mainnet one and leaves a user's own
  endpoint at 100. Before this change the path was unreachable keyless, because the
  list was always empty.
- **NFTs stay unavailable keyless.** No keyless DAS exists — Metaplex retired the
  free Aura endpoints and the hostnames are NXDOMAIN on public resolvers. The only
  remaining candidate is a marketplace's own index, and a wallet asserting ownership
  on one marketplace's authority is a different trust class from reading a balance.
  The empty state says so in as many words.
- **The response bodies are untrusted.** `src/services/jupiter.ts` treats every
  field as `unknown` until checked, ignores everything it did not ask for (including
  Jupiter's own `decimals` and `tokenProgram`), caps body size and request time,
  sends no credentials, strips control and bidi characters out of names, and drops
  any icon URL that is not https — rewriting `ipfs://` onto a gateway that is not
  `ipfs.io`, which 403s an extension origin, and refusing a path whose segments would
  climb back out of that gateway's `/ipfs/` prefix. The body-size guard is enforced
  against the bytes as they arrive rather than after the body is held, because a
  chunked response declares no `content-length` to check.
- Revisiting this means re-running `node scripts/probe-mainnet-rpcs.mjs`, which now
  probes both Jupiter endpoints alongside the RPC field.
