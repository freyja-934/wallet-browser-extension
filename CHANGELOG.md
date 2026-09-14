# Changelog

Notable changes to Cinder Wallet, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

One line per remediation phase (`docs/plans/SHIP-*`); each phase merged as its
own pull request, and the plan it shipped against is the detailed record.

## [Unreleased]

### Added

- **SHIP-16** — A one-of-one is no longer shown as a token. A regular NFT is an
  ordinary SPL mint with a supply of 1 and 0 decimals, and Jupiter's balances carry
  those alongside the fungible holdings, so a collector on a keyless Mainnet install
  read one token row of "1" per collectible they owned. The mint account's `supply`
  was already decoded and discarded; carrying it splits the two apart at no extra
  network cost, and the split happens before the token-account pass, so the token
  list now asks about fewer accounts than it did. A one-of-one is not counted as a
  holding the chain would not confirm, because the chain confirmed it.
- **SHIP-16** — Those collectibles now have a tab of their own on a keyless install,
  with names and pictures read from the chain: each mint's Metaplex metadata account
  through the existing rotated connection, twenty mints a page at the same ten keys
  per call publicnode takes, and then the off-chain document that account points at
  — fetched only for the cards on screen, only once the tab is opened, and never
  from the home tab. An item whose metadata cannot be read still appears, by its
  mint, rather than vanishing. The tab replaces the old "collectibles need an
  endpoint" screen only where that discovery actually ran — Mainnet with no RPC URL
  and no Helius key of your own. Configure your own DAS-less endpoint and you keep
  the endpoint guidance, because nothing looked. A card's collection line shows a
  verified on-chain collection or "Unknown collection", never the mint's own symbol:
  that string is whatever the metadata's author wrote, and an airdropped scam does
  not get to print itself where a verified collection goes.
- **SHIP-16** — Creator-chosen hosts are treated as the hostile input they are. The
  guards `src/services/jupiter.ts` already applied to a third party's response moved
  to `src/lib/untrusted-http.ts` and are now shared: https only (`ipfs://` rewritten
  onto a gateway, refusing any path that climbs out of its prefix),
  `credentials: 'omit'`, an `AbortController` timeout, a size guard enforced against
  the bytes as they arrive, and control and bidirectional characters stripped out of
  every name. A refusal, a timeout, an oversized body, a body that is not JSON and a
  non-https image all resolve to "no picture" and none of them throws.
- **SHIP-16** — The collectibles tab states that compressed NFTs are not listed,
  what they are, and that they need an endpoint of your own. They have no mint
  account and no token account — only a leaf in a Merkle tree — so nothing but a DAS
  indexer can find them, and an incomplete grid that reads as a complete collection
  would be the worse failure. `docs/adr/0005-keyless-collectibles.md` records why.

- **SHIP-15** — Keyless Mainnet now shows SPL and Token-2022 balances, with names,
  symbols and logos, for an install that has configured nothing. No free endpoint
  will enumerate token accounts — publicnode answers `getTokenAccountsByOwner` with
  `-32602 Request blocked` — so the *list of mints* comes from Jupiter's free public
  API, reached only after the RPC path has already refused.
- **SHIP-15** — Every number stays on-chain. Each discovered mint's own account is
  read through the existing rotated connection for `decimals` and the token program,
  and then the wallet's own associated token account of that mint for the amount it
  holds — both batched at ten (publicnode's measured `getMultipleAccounts` cap: ten
  answer in 195 ms, eleven stall three seconds and fail). The send screen converts a
  typed amount with the decimals it displays and offers the balance beside them as
  Max, so neither is taken from Jupiter: its own amount decides which mints to ask
  the chain about and nothing else. A holding the chain will not confirm is dropped
  from the list rather than guessed at, and the count is printed under it — apart
  from the count of holdings past the 200 mints one refresh reads, which were never
  asked about.
- **SHIP-15** — `docs/adr/0004-keyless-token-discovery.md` records what was measured
  and what was rejected: deriving associated token addresses from a curated mint
  list (missed two of seven accounts on a real wallet, including 227 SOL of wrapped
  SOL), and the two keyless RPCs that do serve the method but throttle below this
  wallet's request pattern and exclude the use in their own documentation.
- **SHIP-15** — `scripts/probe-mainnet-rpcs.mjs` now probes both Jupiter endpoints
  alongside the RPC field, from a real `chrome-extension://` page, so the
  reachability claim stays re-verifiable rather than dated.

### Changed

- **SHIP-15** — `TokenBalance.tokenAccount` is optional. A Jupiter-sourced row knows
  a mint and an amount but no account, so the send derives the associated token
  address; a balance held in a non-canonical account will display and then fail at
  send rather than spend from an account the user did not mean.
- **SHIP-15** — The NFT empty state says why collectibles are missing instead of
  only what to do about it: listing them takes the DAS API, no free endpoint serves
  it, and a marketplace's own ownership index is a different trust class from
  reading the chain. NFTs remain keyless-unavailable on purpose.
- **SHIP-15** — The privacy policy, the store listing and the README name
  `lite-api.jup.ag` as a host that receives the user's address when no endpoint is
  configured, and say that entering any RPC URL or Helius key stops the request
  being made. `src/config/legal.test.ts` keeps the shipped and published copies from
  drifting apart.
- **SHIP-15** — `src/config/constants.ts` and the README now say plainly what the
  endpoint rotation can and cannot do: the mechanism is real, but Mainnet's public
  list has one entry, so a keyless install has nothing to fail over to. No second
  public RPC host was added; that is a data-recipient decision for the owner.

## [0.4.0] — 2026-09-14

Five phases over 0.3.0, and the first tagged release. The dApp surface now signs
with the account a site actually asks for; the component tests and coverage gate
that SHIP-8b deferred are in; CI runs on every pull request and builds the store
zip; and the listing images say what the product does.

### Added

- **SHIP-10** — Component tests and a coverage gate, the one piece SHIP-8b
  deferred for want of tooling that had not been authorised. `jsdom`, Testing
  Library and `@vitest/coverage-v8` are installed, `test.include` collects
  `.tsx`, and each component test opts into a DOM with its own
  `// @vitest-environment jsdom` docblock rather than making the 600-odd worker
  and library tests pay for jsdom.
- **SHIP-10** — `BalanceCard` and `SendModal` are tested over the real query
  layer: React Query, the services and the endpoint rotation all run, and only
  `chrome.runtime.sendMessage` and the web3.js `Connection` are stubbed, so a
  test fails on a real regression rather than on a mocked hook. Covered: the
  error card, the "no endpoint reachable" guidance, a dash rather than a zero
  while a read is in flight, the exact SOL figure the lamports say, Max filling
  balance-minus-quoted-fee in integer units where float arithmetic would
  produce an amount the parser refuses, the decimals error blocking Continue,
  and the fee on Review.
- **SHIP-10** — A `Modal` focus test covers what the Playwright suite cannot,
  because it drives one sheet at a time: two sheets stacked, where the one on
  top takes the keyboard, wraps Tab within itself, and Escape closes it alone.
- **SHIP-10** — `pnpm exec vitest run --coverage` enforces a 94 percent lines
  threshold over `src/background/**`, `src/content/**` and `src/lib/**` — the
  code with real logic behind it. The suite measures 94.78 percent, so the gate
  is a ratchet and not an aspiration. It is deliberately not part of
  `just check`, which is run narrow (`just test <file>`) too often for a
  whole-suite threshold; wiring coverage into CI is an owner decision.
- **SHIP-11** — The approval window's Connect screen names the account and the
  cluster the site is being connected to, and spells out what the site will and
  will not be able to do.
- **SHIP-13** — CI builds the Chrome Web Store zip on every pull request and
  push and uploads it as an artifact; the recipe's own guards fail the job if a
  key-shaped literal ever reaches the bundle.
- **SHIP-13** — `docs/store/screenshots/README.md` records which cluster each
  listing image came from and why, and the rule that every composed image is
  read against its own caption before it is committed.
- **SHIP-13 follow-up** — `scripts/probe-mainnet-rpcs.mjs` re-runs the keyless
  mainnet field from a real `chrome-extension://` origin, because curl does not
  enforce CORS and passes endpoints a browser refuses.

### Changed

- **SHIP-11** — A simulation error is rendered as the runtime's own words with
  an explanation, instead of a JSON-quoted string.
- **SHIP-11** — The example dApp talks to publicnode on mainnet, matching what
  the extension itself defaults to.
- **SHIP-12** — The whole store screenshot set was retaken from the real
  extension rather than mocked, along with the listing copy and the README.
- **SHIP-13** — The end-to-end job is opt-in (`workflow_dispatch`) rather than
  part of the pull-request gate: it drives a real extension against public
  devnet, which rate-limits GitHub-hosted runners hard enough that the job's
  result was decided by the faucet rather than by the code. `just e2e` remains
  the strict local gate.
- **SHIP-14** — dApp surface: a site that passed `accounts[1]` to
  `signMessage`, `signTransaction` or `signAndSendTransaction` and silently
  received `accounts[0]`'s signature now receives `accounts[1]`'s. The approval
  window names the signing account on every signature request, not only on
  connect.

### Fixed

- **SHIP-11** — An end-to-end test that needs a funded fixture skips with the
  address, the balance and the shortfall instead of failing. The fixture is a
  public address that bots sweep, so an empty one is a faucet fact and not a
  wallet bug.
- **SHIP-13** — CI could not run at all. `pnpm/action-setup` was given a
  `version` that `package.json`'s `packageManager` already pins, and on Node 20
  jsdom's undici could not load, so three component-test files never started
  while the summary still printed every test green and the job failed with no
  named failure. CI runs Node 24.
- **SHIP-13** — The primary store screenshot promised live prices above a
  Devnet capture showing no balance. The set is rebuilt from a keyless,
  store-equivalent build, each shot taken on the cluster that makes its own
  caption true.

### Security

- **SHIP-14** — A signature is made by the account the request names. The
  Wallet Standard `account` input is carried through the bridge and the
  protocol, resolved to a derivation index against the wallet's own accounts
  inside the service worker (a page names an address, never an index), and
  pinned to the pending approval as `accountAtEnqueue`; the preview, the
  `signerOk` check and the balance diff are all built for that account, and it
  is the key that signs. An address this wallet does not hold is refused rather
  than signed for by whichever account happened to be active, inputs that name
  two different accounts are refused, and switching the active account while an
  approval is waiting rejects it instead of re-pointing it at the new key.

## [0.3.0] — 2026-09-12

Nine remediation phases over 0.2.0, the first Chrome Web Store build. No
`v0.3.0` tag was ever cut; 0.4.0 above is the first tagged release, and it is
what goes to the store.

### Security

- **SHIP-1** — A page could override the bridged message type and reach
  popup-only worker handlers; the content script now honours only the outer
  `type` and builds the worker message field by field from the fields that type
  accepts, never spreading the page's payload into it. The worker binds the
  request to the browser's view of the sender, not to any `origin` it carries.
- **SHIP-3** — `just store` refuses to zip a build that carries an API key, so
  a Helius key in the shell or in `.env` cannot reach the Chrome Web Store
  bundle.
- **SHIP-5** — Approvals are claimed before they are fulfilled and bound to a
  validated requesting origin, so nothing settles a request twice and no site
  sees or signs for an account it was never granted.
- **SHIP-6** — A page can no longer have the wallet sign serialized transaction
  bytes as an opaque message: such a signature is a valid transaction
  signature, so `signMessage` refuses anything that decodes as one.
- **SHIP-7b** — The vault carries its own KDF parameters and is written at
  600,000 PBKDF2 iterations (v1 blobs migrate on the next unlock); secrets no
  longer travel through Redux, and a second create is refused rather than
  replacing an existing wallet.

### Added

- **SHIP-3** — RPC endpoints come from settings: a custom HTTPS URL probed for
  its cluster, a Helius key, and rotation with three distinct verdicts.
- **SHIP-4** — Token-2022 holdings, names from on-chain metadata, paged
  activity, and a separate prices query.
- **SHIP-5** — Connected sites in Settings with Revoke, an inline unlock in the
  approval window, and lock, disconnect, account and cluster changes pushed to
  connected pages.
- **SHIP-6** — The Wallet Standard provider is injected as a MAIN-world content
  script; batched sign requests open one approval window, honour the chain and
  send options, and the window shows a simulated balance diff.
- **SHIP-7a** — Fee estimates, rent guards on both sides of a send, checked
  token transfers under the mint's own program, and a priced Review step.
- **SHIP-7b** — Accounts can be added and renamed, and auto-lock is idle-based
  rather than a countdown from unlock.
- **SHIP-8b** — Modals trap Tab and Shift+Tab, focus their first control on
  open and again when the sheet swaps step, hand focus back to the control that
  opened them, and stack: a dialog opened over a sheet owns the keyboard until
  it closes. Each sheet is named by its own heading.

### Changed

- **SHIP-2** — The worker's message handlers moved into an importable router
  behind a typed protocol validated at the boundary, with an in-memory `chrome`
  stub behind the unit tests and a React Query hook for settings.
- **SHIP-4** — The popup shows what it knows: dashes and error cards, never
  zeros or placeholder data, and totals say when they cover SOL only.
- **SHIP-8a** — Each worker arm is checked against its own response type,
  derived state is computed rather than mirrored through effects, and
  `no-explicit-any` is on.
- **SHIP-9** — The zip is 1.1 MB instead of 19.5 MB: the background loop is
  re-encoded to the size the popup actually plays it at, and the three mint
  fixtures that were never in the product moved to `scripts/assets/`. The popup
  no longer loads the BIP39 wordlist to show a dashboard — onboarding and
  Settings are lazy — and the vendor chunks are named rather than accidental.
- **SHIP-9** — `just store` builds into `dist-store/`, so the mainnet zip no
  longer overwrites the devnet `dist/` that is loaded unpacked, and the built
  manifest's version comes from `package.json`.
- **SHIP-9** — The manifest asks for less: no `web_accessible_resources`, no
  `api.mainnet-beta.solana.com` host permission — it answers 403 to any request
  carrying an `Origin` header, so an extension could never spend it, and it is
  out of the endpoint rotation too — and a CSP that pins `img-src` and
  `media-src` (remote NFT audio and video stay out of scope). `clipboardWrite`
  is kept: it raises no install warning, and the e2e drives the popup as a tab
  with a stubbed clipboard, so the toolbar popup's real write is unverified.
  Icons are generated from the brand mark with store padding.
- **SHIP-9** — README, the store listing and the privacy policy say what the
  keyless store build can and cannot do, name the explorer hand-off and the
  third-party image hosts, and separate what was measured about the public
  mainnet endpoint from what is expected of it. The privacy policy is published
  as `docs/legal/privacy.html` so the URL in the listing resolves once GitHub
  Pages is on, copied from the page the extension ships and held to it by a test.
- **SHIP-9** — README's Load unpacked steps copy `.env.example` to `.env`:
  without it the unpacked build is Mainnet, not the Devnet the steps assume.
- **SHIP-9** — `just check` is typecheck, lint and 595 unit tests in the `node`
  environment. Component tests and a coverage gate were still missing at this
  version: the tooling was not installed and adding it was an outstanding owner
  decision, not a decision against it. SHIP-10 has since added both — see
  Unreleased and `docs/README.md`.

### Fixed

- **SHIP-1b** — `signAndSendTransaction` returns the 64 raw signature bytes;
  System and Token instruction indexes decode correctly; the provider registers
  as Wallet Standard 1.0.0 with a valid icon; an RPC failure reaches the
  approval screen as a decode-only preview instead of a thrown error, and
  Approve stays disabled until the preview settles.
- **SHIP-7a** — A send looks in the ledger before calling itself expired, only
  one send runs at a time, and Review blocks a token send addressed to a token
  account rather than crediting nobody.
- **SHIP-7b** — A recovery phrase is normalised on paste (surrounding quotes
  dropped, case lowered, whitespace collapsed) before BIP39 validation, so a
  phrase from a password manager or a PDF is no longer called invalid; and the
  "I stored this phrase" attestation is a real user action rather than a
  read-only box that ticked itself on reveal.
- **SHIP-8b** — A single RPC blip no longer dead-ends a send: both fee reads
  retry twice with backoff, and the Review pane's fee error and the Amount
  step's balance error each carry a Retry, so "Unavailable" is no longer a
  state the user can only escape by closing the modal.

### Removed

- **SHIP-9** — `nft-img.png`, `nft-video.mp4` and `token-img.png` no longer
  ship in the extension; `scripts/mint-cinder.mjs`, the only thing that reads
  them, now takes them from `scripts/assets/`.

---

Releases before 0.3.0 (0.2.0, the first Chrome Web Store build) predate this
file; see the git history.
