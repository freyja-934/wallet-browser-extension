# SHIP-16 — Regular NFTs, and keeping them out of the token list

## Goal

Two things, and the first matters more than the second.

1. **A one-of-one is not a token.** Mints the wallet holds with supply 1 and 0 decimals
   must leave the token list. SHIP-15 shipped keyless token discovery without this filter,
   so a collector on a keyless mainnet install sees their collectibles listed as tokens
   with a balance of "1". That is a live defect and this phase's first job.
2. **Show those collectibles properly**, with name and picture, read keylessly.

Compressed NFTs stay invisible and the tab must say so.

**Tokens are the primary surface. Collectibles are secondary.** No work in this phase may
slow, block or consume the budget of the token path. If a choice arises, tokens win.

## Context

Verified on 2026-09-14, every claim from a real `chrome-extension://` origin.

- A regular NFT is an ordinary SPL token with `supply` 1 and `decimals` 0. Confirmed by
  reading a real Mad Lads mint from publicnode.
- Jupiter's balances endpoint, already fetched for tokens in SHIP-15, **already returns NFT
  mints**: 52 of 75 entries for a real collector's wallet had an amount of exactly 1.
- publicnode reads the Metaplex metadata account keylessly via `getAccountInfo`. Three real
  NFTs decoded end to end: "Frog #8699", "Frog #8603", "sharx #4677", each with its image
  URI on Arweave.
- `src/lib/token-metadata.ts` already exports `metadataPda()` and `decodeMetadata()`, which
  return name, symbol and uri. Both already exist and are already tested.
- `mintFactsFrom` in `src/services/helius.ts` reads `decimals` and `programId` from the
  mint account but discards `supply`, which `unpackMint` already decoded. The filter this
  phase needs costs no extra network call.
- **Compressed NFTs cannot be done.** They have no mint account and no token account; they
  are leaves in a Merkle tree, and only a DAS indexer can enumerate them. Metaplex retired
  the free DAS endpoints and the hostnames no longer resolve. This is a property of the
  data structure, not a gap to engineer around.

## Steps

1. **Stop showing collectibles as tokens.**
   Files: `src/services/helius.ts`.
   `unpackMint` already decodes `supply`. Carry it into `MintFacts` and add a derived
   `isOneOfOne` (supply exactly 1n and decimals exactly 0). Exclude those mints from the
   token list built in `tokensFromJupiter`. They are not "unconfirmed" and must not be
   counted in `OmittedHoldings.unconfirmed`, which would tell the user their mint accounts
   could not be read. This step alone fixes the defect and is worth landing even if every
   later step were dropped.
   Verify: `just check`

2. **Collect the one-of-ones as collectibles.**
   Files: `src/services/helius.ts`.
   The same confirmed set now yields two lists. Return the one-of-one mints so the NFT
   path can use them without a second Jupiter call. Do NOT fetch any metadata here: this
   runs on the home tab and must stay as cheap as it is today.
   Verify: `just check`

3. **Names and pictures, lazily.**
   Files: `src/services/helius.ts` or a new `src/services/collectibles.ts`.
   When the collectibles view asks, read the Metaplex metadata account for each one-of-one
   through the existing rotated connection with `metadataPda` and `decodeMetadata`,
   batched at `MINT_INFO_BATCH` (publicnode caps `getMultipleAccounts` at 10). Page the
   work: a wallet with hundreds of collectibles must not issue hundreds of calls at once.
   A mint whose metadata cannot be read still appears, by its mint address, rather than
   vanishing.
   Verify: `just check`

4. **The picture.**
   Files: the collectibles service, `src/components/nfts/`.
   `decodeMetadata` gives a `uri` pointing at off-chain JSON holding the image URL. Fetch
   it only for the items actually on screen. Treat it as hostile input exactly as
   `src/services/jupiter.ts` does: https only, `credentials: 'omit'`, an AbortController
   timeout, a response-size guard that reads through the stream, and every field
   validated. Reject any image URL that is not https, rewriting `ipfs://` with the same
   helper `jupiter.ts` already uses. Render with `<img>`; the CSP already allows
   `img-src https:` and `<img>` is not CORS-restricted, so no fetch is needed for the
   image itself.
   Verify: `just check`

5. **Tokens stay first.**
   Files: the query layer, `src/components/nfts/NFTGallery.tsx`.
   Nothing in steps 3 and 4 may run while the user is on the home tab, and the token
   query must never await any of it. Prove it with a test that mounts the dashboard and
   asserts no metadata or image request was made.
   Verify: `just check`

6. **Say what is missing.**
   Files: `src/components/nfts/NFTGallery.tsx`.
   The gallery states plainly that compressed collectibles are not listed, what they are
   in one clause (used for airdrops and free mints), and that they need a user-supplied
   endpoint. It must not imply the collection shown is complete.
   Verify: `just check`

7. **Tests.**
   Files: the new service test, `src/services/helius.test.ts`,
   `src/components/nfts/` tests.
   Cover: a supply-1 zero-decimal mint never reaches the token list and is not counted as
   unconfirmed; a supply-1 mint with non-zero decimals is still a token; a metadata
   account that is absent, truncated, or not a metadata account leaves the item visible by
   mint; a metadata JSON that is malformed, oversized, slow, or serves a non-https image
   yields no image and no throw; and the home tab issues no collectible request.
   Verify: `just check`, then `just e2e`

8. **Docs.**
   Files: `docs/adr/0005-keyless-collectibles.md` (new), `README.md`, `CHANGELOG.md`,
   `docs/store/listing.md`, `public/legal/privacy.html` then
   `node scripts/sync-legal.mjs`.
   The ADR records what a compressed NFT is and why it cannot be listed keylessly. The
   privacy policy must say that viewing a collectible fetches its metadata and image from
   whatever host its creator chose. The listing currently tells a reviewer that NFTs need a
   user-supplied endpoint on mainnet; that is now only true of compressed ones.
   Verify: `just check`

## Out of scope

- Compressed NFTs. No keyless source exists.
- Any marketplace index. Asserting ownership on a marketplace's authority is a different
  class of claim from reading the chain.
- Sending, burning or listing a collectible. Display only.
- Collection grouping, floor prices, attributes, and anything requiring an indexer.

## Risks

- **A regression in the token list is worse than having no gallery.** Tokens are the
  primary surface; every step must leave the token path at least as fast as it is today.
- **Arbitrary hosts.** Metadata and image URLs point wherever the NFT's creator chose.
  That is a tracking vector and it must be disclosed, lazy, and validated.
- **A collector with hundreds of items** must not produce hundreds of simultaneous calls
  against an endpoint capped at ten accounts per request.
- **A hostile metadata document** must not reach the interface unvalidated.

## Parking lot

- Compressed NFTs behind a user-supplied endpoint, which already works through DAS.
- Collection grouping and floor prices.
