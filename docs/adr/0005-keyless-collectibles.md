# ADR 0005 — Keyless collectibles: a one-of-one is not a token, and a compressed one cannot be seen

## Context

ADR 0004 closed half the keyless Mainnet gap: `getTokenAccountsByOwner` is refused
by the one public endpoint, so the *list of mints* comes from Jupiter and every
number is read from the chain. It closed that half with a defect, and this ADR
records both the defect and the half it left open.

The defect: **a regular NFT is an ordinary SPL token.** It is a mint with a supply
of 1 and 0 decimals, held in an ordinary token account. Jupiter's balances
endpoint returns those mints alongside the fungible ones — for a real collector's
wallet, 52 of 75 entries had an amount of exactly 1 — and SHIP-15 shipped no test
to tell them apart. So a collector on a keyless Mainnet install read one token row
of "1" for every collectible they owned. Tokens are this wallet's primary surface,
and that is a live wrong answer on it.

The open half: ADR 0004 said NFTs stay unavailable keyless, because no free DAS
endpoint exists. That was true of the *enumeration* and it is still true of one
kind of NFT. It was not true of regular ones, which were sitting in a list this
wallet already fetched.

Everything below was measured on 2026-09-14 from a real `chrome-extension://`
page, never from curl, for the reason ADR 0003 gives.

## Decision

### The mint account already knows

`unpackMint` decodes `supply` out of the same 82 bytes `mintFactsFrom` already
reads for `decimals` and the token program. Carrying it costs **no extra network
call**: `MintFacts` gains `supply` and a derived `isOneOfOne` — supply exactly
`1n`, decimals exactly `0` — and `tokensFromJupiter` splits the confirmed set on
it.

The split happens *before* the second chain read, so the token path asks about
fewer associated token accounts than it did yesterday. Nothing about this phase
makes the token list slower; the one measurable change to it is that it is
cheaper.

A one-of-one is not counted in `OmittedHoldings.unconfirmed`. That counter is a
sentence about the endpoint — the line under the list tells the user the chain
would not back a holding up — and the chain backed these up perfectly well. Saying
otherwise would send a collector looking for an RPC problem that is not there.

Three cases were checked and are held by tests: a mint with supply 1 and non-zero
decimals is still a token (one whole unit of a divisible mint), a mint with 0
decimals and a real supply is still a token, and a burned one-of-one has supply 0
and falls back to the token path, where the empty token account drops it as it
always did.

### Names and pictures, read keylessly and lazily

The one-of-one mints come back on `TokenBalances.collectibles` — base58 addresses
and nothing else. The collectibles tab then reads, and only when it is opened:

- **The Metaplex metadata account** of each mint, at the PDA `metadataPda`
  already derives, through the same rotated connection, batched at the same ten
  keys per call publicnode caps `getMultipleAccounts` at. `decodeMetadata`
  already existed and is reused unchanged; three real NFTs decoded end to end
  ("Frog #8699", "Frog #8603", "sharx #4677"), each with its image URI on Arweave.
- **The off-chain metadata document** named by that URI, one per card that is
  actually rendered, for the `image` URL.

The work is paged at `COLLECTIBLES_PAGE` (20 mints, two RPC calls), with a button
for the next page — shown whatever is typed in the search box, because a search
runs over the pages read so far and hiding the control would leave a user unable
to reach the item they are searching for.

This tab replaces the old "collectibles need an endpoint" screen **only when the
keyless discovery actually ran**, which takes two conditions, not one.
`nftsUnavailable` says no endpoint here answers DAS; `jupiterEnabledFor` — mainnet,
no RPC URL, no Helius key — is what decides whether Jupiter was asked at all. A
user with their own DAS-less endpoint satisfies the first and not the second, and
has no collectible list for the same reason their address never went to Jupiter.
The gate is therefore `nftsUnavailable && tokensSource === 'jupiter'`; everyone
else keeps the endpoint guidance. Saying "nothing this wallet holds reads as a
one-of-one" to a collector nothing had looked at would be the same class of wrong
answer this ADR exists to remove from the token list.

### The document is the most hostile input this wallet reads

The URI points wherever the NFT's creator wrote — an address no manifest can
enumerate and no allowlist can anticipate, which is precisely why no new host
permission was added and none could be. The rules are the ones `jupiter.ts`
already applied to a third party's balances, extracted to
`src/lib/untrusted-http.ts` so there is one copy rather than two: https only
(`ipfs://` rewritten onto a gateway that is not `ipfs.io`, refusing any path whose
segments climb out of the `/ipfs/` prefix), `credentials: 'omit'`, an
`AbortController` timeout, a size guard enforced against the bytes as they arrive
rather than after the body is held, and every field `unknown` until checked.
Names and symbols out of the metadata account go through the same control- and
bidi-character strip a token symbol does.

The image itself is rendered with `<img>`, which the CSP's `img-src 'self' https:
data:` already allows and which is not CORS-restricted, so nothing fetches it.

The *document* is not so lucky, and this is the one place the keyless picture is
host-dependent. A `fetch` from a `chrome-extension://` page to a host outside
`host_permissions` is an ordinary cross-origin request: it carries an `Origin`
header and needs `Access-Control-Allow-Origin` back. Arweave and dweb.link send
`*`; a collection serving its metadata off its own API host may send nothing, and
then the browser rejects the response before any body arrives. `fetchGuardedJson`
resolves `undefined` exactly as it does for a timeout, so the card shows its
placeholder. That is a card with no picture and a perfectly good URI, and it is
the expected outcome rather than a bug. Asking for the permission instead is not
open to us: the hosts are whatever each creator wrote, an `https://*/*` grant is
the whole web, and the optional-host grant this wallet does request is only ever
for the one RPC origin the user typed.

Every failure resolves to "no picture" and none of them throws. An item whose
metadata account is absent, truncated, or not a metadata account at all still
appears, by its mint: the wallet holds it either way, and hiding it is the one
answer that is certainly wrong.

### Compressed NFTs cannot be listed, and the tab says so

A compressed NFT has **no mint account and no token account**. It is a leaf in a
Merkle tree whose root is the only thing on-chain, and reconstructing ownership
from it means replaying the tree's transaction log — which is what a DAS indexer
is for. Jupiter's balances cannot see one, `getMultipleAccounts` has nothing to
ask about, and no amount of engineering against the chain changes that: it is a
property of the data structure, not a gap. Metaplex retired the free DAS
endpoints and the hostnames no longer resolve.

So the gallery states it outright — that compressed collectibles are not listed,
what they are in one clause (the cheap kind used for airdrops and free mints),
that only a DAS indexer can find them, and that the list shown is not the user's
whole collection. An incomplete grid that reads as a complete one is a worse
failure than an empty tab that explains itself.

## Consequences

- **Keyless Mainnet stops lying about collectibles in the token list.** This is
  the part worth landing on its own, and it would have been worth landing even if
  the gallery had been dropped.
- **Ownership of a listed collectible is discovered, not proved.** The keyless
  path reads a mint account and a metadata account; neither names an owner. The
  claim "you hold this" rests on Jupiter's balances, exactly as the token list's
  discovery does — but unlike a token row, nothing here is spendable, sendable or
  burnable, so a stale entry costs a picture and not a transaction. The
  wallet-level `ownership` field DAS supplies is therefore absent on a keyless
  item rather than invented, and the note under the list says where the mints came
  from. Confirming each one's token account would double the tab's chain reads for
  a display-only surface, and was rejected on those grounds.
- **Metadata and image hosts see the user's IP.** They are chosen by the NFT's
  creator, not by this wallet. That is a tracking vector and it is disclosed in
  `public/legal/privacy.html` and the store listing. It is also strictly lazy: the
  home tab issues no such request, and `src/components/nfts/NFTGallery.test.tsx`
  mounts the whole dashboard and asserts that no collectible metadata account is
  read and no creator host is contacted until the tab is opened.
- **The token path is untouched except to get cheaper.** No collectible work runs
  on the balances query, and the token query never awaits any of it.
- **Editions and semi-fungibles read as tokens.** A master edition with a supply
  above 1 does not match, and neither does a fungible asset at 0 decimals with a
  real supply. Grouping by verified collection, floor prices and attributes all
  need an indexer and stay out of scope, so a keyless card's collection line reads
  "Unknown collection". It deliberately does **not** fall back to the mint's own
  symbol: `grouping` is an on-chain *verified* collection key, the symbol is a
  free string the metadata's authority chose, and printing one where the other
  goes would let an airdropped scam declare itself "Mad Lads" in the field that
  means a verified Mad Lads. The symbol is still searchable; it is just not
  presented as provenance.
- **The filter covers the keyless path only.** `tokensFromJupiter` splits on
  `isOneOfOne` because it has already read each mint account. The RPC path builds
  its rows from `getParsedTokenAccountsByOwner`, which returns no supply, so a
  wallet on its own endpoint or a Helius key still sees a one-of-one as a token
  row of "1" — with DAS, it also sees the same item properly in the collectibles
  tab. Reaching parity would mean a `getMultipleAccountsInfo` pass over every mint
  on the path that is currently the fastest one, which is a cost to the primary
  surface for a cosmetic gain on the secondary one. Recorded here rather than made
  silently: the two paths disagree, and this is why.
- **A user-supplied endpoint is still strictly better.** Enter an RPC URL or a
  Helius key and DAS answers, which lists compressed NFTs too and supplies real
  collection grouping. The keyless path is the floor, not the ceiling.
