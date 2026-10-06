# Cinder Wallet

[![check](https://github.com/freyja-934/wallet-browser-extension/actions/workflows/check.yml/badge.svg)](https://github.com/freyja-934/wallet-browser-extension/actions/workflows/check.yml)

Self-custodial Solana wallet for Chrome (Manifest V3). The encrypted keyring lives in the service worker — the popup never holds a `Keypair`. Sites talk [Wallet Standard](https://github.com/wallet-standard/wallet-standard), not a fake `window.solana`.

This is a portfolio implementation. It does not impersonate Phantom. It has not been audited. Do not put mainnet funds on it that you cannot lose.

<p align="center">
  <img src="docs/store/screenshots/01-home-1280x800.png" width="72%" alt="Cinder Wallet home — portfolio and assets" />
</p>
<p align="center">
  <img src="docs/store/screenshots/02-approve-1280x800.png" width="32%" alt="Approval with a simulated balance change" />
  <img src="docs/store/screenshots/03-connect-1280x800.png" width="32%" alt="Connect consent screen" />
  <img src="docs/store/screenshots/04-send-1280x800.png" width="32%" alt="Send review with a network-quoted fee" />
</p>

## What this demonstrates

- MV3 service worker lifecycle and idle-based auto-lock (`chrome.alarms`)
- BIP39 → BIP44 `m/44'/501'/n'/0'` derivation (`mnemonicToSeed`, not `Buffer.from(mnemonic)`)
- Wallet Standard: `standard:connect` (with `silent`), `standard:disconnect`, `standard:events`, `solana:signTransaction`, `solana:signAndSendTransaction`, `solana:signMessage`. Each account's `chains` is the active cluster and is re-stamped on a cluster change, so wallet-adapter can send on either.
  - N inputs to one `signTransaction` or `signMessage` call (at most 10, and at most 256 KiB in total) are one approval window and N outputs in order; `signAndSendTransaction` takes exactly one transaction per call, forwards `skipPreflight`, `preflightCommitment`, `maxRetries` and `minContextSlot`, and waits for `commitment` for at most 30 s.
  - `signMessage` refuses bytes that decode as a serialized transaction message — such a signature would be a valid transaction signature.
  - The `account` input picks the signer: its address is resolved to a derivation index against the wallet's own accounts inside the worker (a page names an address, never an index) and pinned to the approval, so the key that signs is the one the approval window names; an address this wallet does not hold is refused, and switching the active account rejects an approval bound to another one.
- Vault v2: the blob carries its own version and KDF parameters, PBKDF2-SHA256 at OWASP's 600,000 iterations with AES-256-GCM. A v1 blob (unversioned, 100k) is re-encrypted on the next successful unlock, written before anything else in that unlock; a blob this build cannot read is refused as `Unsupported vault format` rather than reported as a wrong password. See `docs/adr/0002-vault-v2.md`.
- Multiple accounts: add (next `m/44'/501'/n'/0'`), rename, switch. Accounts are looked up by derivation index, never by position, list writes are serialised in the worker, and the list survives a lock.
- Per-origin trust: connect once, revoke in Settings; the full approval lifecycle (window close, page timeout, revoke, lock) with `change` events pushed to connected pages.
- Legacy and v0 transactions, with address lookup tables resolved in the preview.
- Simulation preview: a balance diff (SOL and tokens, before → after) from `simulateTransaction` pinned to the slot of the account read, program names, `setAuthority` and approve warnings, unknown programs. Approve is disabled while the preview is unsettled, when an instruction is unreadable, or when the active account is not a required signer.

## Architecture

```
Page → injected provider (MAIN world, Wallet Standard)
     → content script (allowlisted message types, origin from the browser)
     → service worker: router.ts, one arm per protocol.ts request type
     → keyring (the only place a Keypair exists)

Popup / approval window → chrome.runtime.sendMessage → the same router
Worker → connected pages → chrome.tabs.sendMessage → standard:events `change`
         (lock, disconnect, revoke, account change, cluster change)

Vault (v2): PBKDF2-SHA256 600k + AES-256-GCM in chrome.storage.local; the blob carries its own version and KDF parameters
Session:    chrome.storage.session, cleared when the browser closes; no local fallback
Origins:    connected sites in chrome.storage.local (Settings → Connected sites → Revoke)
Popup state: Redux for lock / accounts / modals, React Query for everything read from a chain
```

The content script never forwards a page's payload into the worker message: it honours the outer `type` and rebuilds the message field by field from the fields that type accepts, and the origin is the browser's view of the sender, never a value the page supplied. The worker validates every request against `protocol.ts` at the boundary and every response against that request's own response type.

A site must be approved once (Connect) before it can read the address or ask for a signature. A connected site's later `connect()` answers without a window, `connect({ silent: true })` never prompts, and a request from a site that never connected is refused with `Not connected`. One request per site is pending at a time; closing the approval window or the site's tab rejects it, the page withdraws it shortly before its own 120 s timeout, disconnecting or revoking rejects it, the worker expires anything older than 5 minutes, and locking rejects everything queued. Approve claims a request before signing, so whatever is broadcast is what the site is told about, and a page can only poll or cancel its own request. A connect or sign while locked opens the approval window with the unlock form inside it. There is no keep-alive port: the worker wakes per message and pending approvals survive in `chrome.storage.session`.

The toolbar popup is **380×600** (Chrome caps action popups at 600px). Approvals open `approve.html` via `chrome.windows.create`, never `chrome.action.openPopup()`.

## What you get, with and without an RPC key

Cinder ships with no API key — a key in a Chrome Web Store zip is a key anyone can extract. The endpoint list comes from Settings, not the build, and what the wallet can show depends on what that endpoint serves.

| | Store build, nothing configured | With your own RPC URL or Helius key in Settings |
|---|---|---|
| SOL balance, send, receive | yes | yes |
| Transaction history | yes (decoded on-chain) | yes, enriched |
| USD prices | yes (CoinGecko) | yes |
| SPL and Token-2022 balances | yes, from the chain, through Cinder's RPC proxy | yes |
| Token names and logos | yes, from DAS on that proxy, with on-chain metadata behind it | yes |
| Collectibles | yes, both kinds, when the proxy is up (it serves DAS). If it is down, regular NFTs only, via the publicnode fallback | yes, both kinds |
| dApp connect, sign, simulation preview | yes | yes |

How the keyless token list works: the store build talks to `https://cinder-rpc.casey-722.workers.dev` first. That Worker holds a Helius key that is not in the zip, and it forwards an allowlisted JSON-RPC method — including `getTokenAccountsByOwner` and DAS `getAssetsByOwner`. Every number you act on is still read from the chain. The decimals a row displays are what the send screen converts your typed amount with, and the balance beside them is what Max fills in. See [ADR 0006](docs/adr/0006-keyless-rpc-proxy.md).

Jupiter is the fallback, not the default. No free public host will enumerate token accounts — publicnode answers `getTokenAccountsByOwner` with `-32602 Request blocked` — so Jupiter is asked *which mints* an address holds only when every endpoint has refused that method. A proxy that is merely down is not that case: SOL still comes from publicnode, and the token list says the read failed. When Jupiter does run, it supplies discovery and cosmetics only. The wallet then reads the mint accounts and the associated token accounts itself, in batches of ten, which is publicnode's measured cap on `getMultipleAccounts` (ten answer in 195 ms, eleven stall three seconds and fail). A holding neither read confirms is dropped rather than guessed at, and the popup says how many — separately from the ones past the 200 mints one refresh reads. A balance kept in a token account that is not the associated one is counted as unconfirmed rather than shown, because that path has no account address to spend from. On that fallback, `lite-api.jup.ag` sees your address. Entering any RPC URL or a Helius key in Settings turns Jupiter off entirely, and it is never used on Devnet. See [ADR 0004](docs/adr/0004-keyless-token-discovery.md).

How the keyless collectibles tab works: a regular NFT *is* an ordinary SPL token — a mint with a supply of 1 and 0 decimals — so Jupiter's balances already carry them, and SHIP-15 showed them in the token list as a balance of "1". They are now told apart from the mint account's own `supply`, which the wallet already read and had been discarding, so the split costs no extra call and the token path asks about **fewer** accounts than before. The collectibles tab then reads each one's Metaplex metadata account for a name and a URI, twenty mints a page, and follows that URI for the picture only for the cards on screen — https only, no cookies, a timeout, a size guard on the bytes as they arrive, every field checked. Nothing of this runs on the home tab. The document fetch is an ordinary cross-origin request from an extension page, so a creator's host that publishes no CORS header yields no picture and the card keeps its placeholder — a perfectly good URI can still end there, and no manifest entry could fix it, since the hosts are whatever each creator wrote. The tab appears in place of the "needs an endpoint" screen only where the keyless discovery actually ran (Mainnet with no RPC URL and no Helius key of your own); configure your own DAS-less endpoint and you get the endpoint guidance, because nothing looked. **Compressed NFTs are listed when the proxy answers DAS**, which is the indexer those leaves require. They have no mint account and no token account. When the proxy is down and the only host left is publicnode, the tab says they are missing rather than pretending the grid is complete. See [ADR 0005](docs/adr/0005-keyless-collectibles.md) and [ADR 0006](docs/adr/0006-keyless-rpc-proxy.md).

Keyless Mainnet tries two hosts: the Cinder proxy, then `https://solana-rpc.publicnode.com`. `https://api.mainnet-beta.solana.com` returns 403 to any request carrying an `Origin` header — which every extension request does — so it is in neither the endpoint list nor the manifest. publicnode publishes CORS headers that accept a browser origin, and it serves no DAS and refuses `getTokenAccountsByOwner` — measured, not assumed: `-32602 Request blocked` and `-32601` respectively, from a real extension origin (see [ADR 0003](docs/adr/0003-keyless-mainnet-endpoint.md)). That is why it is the fallback and not the default. Devnet stays on the public devnet host, which serves both.

Where a read is not available, the popup says so: tokens, when the keyless fallback cannot help either, show "add an RPC endpoint in Settings", and the collectibles tab says outright that compressed ones are missing and need an endpoint of your own, a failed read shows an error card with Retry, and the portfolio figure is marked `· SOL only`. A list that did come from the keyless fallback says so under itself, along with how many holdings the chain would not confirm and, separately, how many were past the number one refresh reads. It never shows a zero balance it does not know.

Settings → RPC takes a custom HTTPS URL (probed with `getHealth` and `getGenesisHash`, and only used on the cluster it answered for) and a Helius API key. Both are stored in `chrome.storage.local` on that device and are never sent anywhere but the endpoint itself. A custom host outside the manifest is granted through `optional_host_permissions` at the moment you click Save. The order tried is custom URL, then Helius, then the public defaults.

Endpoint rotation, in one paragraph: HTTP 401/403 and a refused method (JSON-RPC `-32601`, `-32010`, `-32011`, or a message saying the method is unsupported or key-gated) skip to the next endpoint for that call only; 408/429/5xx, transport errors and node-health codes rest that endpoint for 30 s; any other JSON-RPC error is returned at once, because every endpoint would say the same. Balances stay fresh for 30 s, NFTs and history for 60 s, on-chain names for 5 min; switching account, cluster or endpoint shows a loading state rather than the previous scope's numbers.

What that rotation can and cannot do, said plainly: the mechanism is real — cooldowns, health marking and reordering, all of it in `src/lib/rpc-rotate.ts` and covered by `src/lib/rpc-rotate.test.ts`. On keyless Mainnet the list is the proxy, then publicnode. A 429 or a 5xx from the proxy rests it for 30 seconds and the next call goes to publicnode, which can still show SOL, send, and history. It cannot list token accounts or compressed NFTs. When both are unreachable the popup says so and asks for an endpoint in Settings, rather than showing a zero. A custom URL or a Helius key is tried ahead of both.

## Known limitations

- **Localnet is not supported.** wallet-adapter maps a localhost endpoint to `solana:localnet`, and the wallet lists only `solana:mainnet` and `solana:devnet`. A request naming another chain is refused with "Cinder is on Devnet; switch networks in Settings". `just dapp` runs on devnet.
- **Compressed NFTs need DAS.** A compressed NFT has no mint account and no token account — it is a leaf in a Merkle tree, and reconstructing ownership means replaying that tree's transaction log, which is what a DAS indexer is for. The keyless proxy serves DAS, so a keyless install lists them while that proxy answers. publicnode does not, and Metaplex retired the free Aura endpoints, so when the proxy is down the gallery says the compressed ones are missing rather than letting a partial grid read as a whole collection. See ADR 0005 and ADR 0006.
- **A Jupiter-fallback collectible's ownership is discovered, not proved.** Those mints come from Jupiter; the mint and metadata accounts the wallet reads afterwards name no owner. Nothing on that tab is spendable, so a stale entry costs a picture rather than a transaction. While the proxy is up, collectibles come from DAS instead.
- **Collectible pictures come from hosts the creator chose.** The metadata document and the image live wherever the NFT's creator wrote, so those hosts see your IP. The request is made only for the items on screen, only once the tab is opened, and only over https.
- **A one-of-one can still appear as a token row of "1".** `getTokenAccountsByOwner` does not return supply, so the proxy path and a user's own endpoint list that mint as a token and, properly, in the collectibles tab, which DAS fills. The supply split that keeps it out of the token list runs only on the Jupiter fallback, which had already read the mint account. Closing the gap on the fast path would add a chain read for a cosmetic gain; see ADR 0005.
- **A Jupiter-sourced token row cannot spend a non-canonical token account.** That fallback returns a mint and an amount, not an account, so the send derives the associated token address. A balance held somewhere else will display and then fail at send with "source not found" rather than spend from an account you did not mean. With the proxy up, or with your own endpoint, the token accounts are enumerated and this does not arise.
- **The Jupiter fallback confirms at most 200 mints.** That path runs only when every endpoint has refused to list token accounts. Each ten cost a round trip through publicnode, and wallets holding thousands of airdropped mints are real. Whatever is past the cap, or whose mint account could not be read, is counted under the list rather than dropped in silence. When the proxy is answering, the list comes from `getTokenAccountsByOwner` and this cap does not apply.
- **Keyless Mainnet depends on the proxy, and on publicnode behind it.** The proxy is the Worker in `workers/rpc`; its Helius key is a secret on that Worker, not a string in the zip. publicnode remains the degraded path and is goodwill, provided AS IS with unpublished limits. It was verified rather than assumed: on 2026-09-14 `E2E_LIVE_MAINNET=1 just e2e e2e/rpc.spec.ts` passed from a `chrome-extension://` origin (a `getHealth` 200). The free field either refuses a browser origin, demands a key, or blocks the indexed methods; the survey is in [`docs/adr/0003-keyless-mainnet-endpoint.md`](docs/adr/0003-keyless-mainnet-endpoint.md) and the proxy decision is in [`docs/adr/0006-keyless-rpc-proxy.md`](docs/adr/0006-keyless-rpc-proxy.md). When no endpoint answers, the popup says so and asks you to add one in Settings rather than showing a zero.
- **Connecting a site shares every account, including ones created later.** The
  connect screen says so, and each signature is still approved separately and
  signed by the account the request names. But a second account added after the
  connect is pushed to sites connected earlier in a `change` event, with no
  fresh prompt, which links the two addresses for anyone watching that dApp.
  Revoke the site in Settings if that matters to you. Per-origin account scoping
  is recorded but not enforced; narrowing it is a permission-model change, not a
  bug fix.
- **Chrome 111 or later.** The Wallet Standard provider is a MAIN-world content script, which is what that version added. There is no Firefox build.
- **No hardware wallets, swaps, staking, NFT transfers, or token-approval management.** Send covers SOL and SPL / Token-2022 tokens.
- **Not audited.** The vault, the origin model and the approval lifecycle have unit and end-to-end tests, and no third-party review.

## Load unpacked

```bash
pnpm install     # or: just setup
cp .env.example .env   # required — without it the build is Mainnet
just ext         # or: pnpm build:extension
```

`.env` is gitignored, so a fresh clone has none, and `VITE_NETWORK` then falls back to its default: **Mainnet**. Copying `.env.example` is what makes `dist/` the `VITE_NETWORK=devnet` build the steps below, the test wallet and `just e2e` all assume. Rebuild with `just ext` after any change to `.env`.

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `dist/`
4. Run `just dapp` and open http://localhost:5174 (`file://` will not inject the provider — and the dApp reads the same `.env`, so it is on Devnet too)
5. Connect → Sign message → Sign v0 transfer (approval window + simulation preview)

Check the network pill in the popup before you do anything with funds: it names the cluster the build was compiled for. `just store` builds Mainnet into `dist-store/` instead, so the unpacked extension you have loaded never changes network underneath you.

Optional: set `VITE_HELIUS_API_KEY` in that `.env` to seed the Settings field during development. Never commit an API key; `just store` refuses to zip a build that contains one.

## Commands

```bash
just setup      # pnpm install
just check      # tsc + lint + vitest run — the gate
just ext        # build the loadable extension into dist/ (the cluster comes from .env; Mainnet if there is none)
just dapp       # http://localhost:5174 Wallet Standard test dApp
just e2e        # build, then Playwright Chromium against the real extension
just store      # mainnet zip for the Chrome Web Store into dist-store/ (does not submit)
```

`CINDER_OUT_DIR` overrides the output directory of `just ext` (`just store` sets it to `dist-store`).

`pnpm exec vitest run --coverage` runs the same suite with a 94 percent lines threshold over
`src/background/`, `src/content/` and `src/lib/`. It is separate from `just check` because the
threshold is a whole-suite figure and `just test <file>` is a narrow run; see `docs/README.md`.

Privacy and terms: `docs/legal/` (the same text ships as `legal/privacy.html` and `legal/terms.html`). Chrome Web Store paste: `docs/store/listing.md`. Docs map: `docs/README.md`. Release notes: `CHANGELOG.md`.

## Extension e2e

- `just e2e` loads Cinder Wallet into Playwright's bundled Chromium (`channel: 'chromium'`), not branded Google Chrome, which removed `--load-extension`.
- It builds `dist/` first and the suite assumes Devnet, so `.env` must exist with `VITE_NETWORK=devnet` (`cp .env.example .env`) or set `VITE_NETWORK=devnet` in the environment. A Mainnet `dist/` fails the suite rather than spending real funds.
- First time: `pnpm exec playwright install chromium`
- A full run spends 10000 lamports of the devnet fixture: two fee-only self-transfers (the dApp `signAndSend` approval and the popup send). Nothing leaves the address; top it up at https://faucet.solana.com when it runs low.
- A funded fixture runs everything; an empty one **skips** the six tests that need funds (the four in `e2e/send.spec.ts` and the two `signAndSend` cases in `e2e/dapp.spec.ts`), naming the address, the balance and the shortfall. Nothing is retried and no assertion is relaxed — the fixture is a public address bots sweep, so an empty one is a faucet fact, not a wallet bug. See `docs/test-wallet.md`.
- Coverage: import / unlock, dashboard tabs, create-new with the seed quiz, a second `CREATE_WALLET` against an existing vault refused rather than replacing it, Send → Review (junk address, Max as balance minus the priced fee, the decimals error, the fee row) and one confirmed 0.001 SOL devnet self-transfer, settings auto-lock / export seed / change password, add / switch / rename a second account surviving a lock, Receive copy (the address handed to `navigator.clipboard.writeText`, which the spec stubs — the real clipboard write is a manual check), dApp connect / sign-message / sign-v0, two transactions in one call, cluster switch re-stamping `chains`, wrong-chain refusal, transaction-as-message refusal, a page trying to override the bridged message type, locked connect unlocking inside the approval window, `signAndSend` reject and a 0-lamport `signAndSend` approve, approval window close → reject, silent and repeat connect, Connected sites → Revoke, `Not connected` for a stranger, and lock → empty `change`.

## Chrome click-through (after Load unpacked)

1. Create a wallet, close the popup, reopen — you should see Unlock, not Create
2. Unlock, then `just dapp` → http://localhost:5174
3. Connect (approval window) → Sign message → Sign v0 transfer (simulation preview). Connect again: no window. Lock in the popup: the dApp log shows `change` with no accounts
4. In the popup, Receive → Copy should toast "Address copied" and paste back the full address — this is the one clipboard check no automated test can make, because the e2e drives the popup as a tab and stubs `navigator.clipboard`; Settings → Connected sites lists localhost:5174 with Revoke
5. Optional on **devnet only**: use the faucet if needed, then send a small amount of SOL or an SPL token. Activity should show the amount, not "On-chain".

## Security notes

- Not audited. Do not use this with mainnet funds you cannot lose
- Cinder registers under its own name only. It never sets `isPhantom` and never writes `window.phantom`
- An RPC key belongs in Settings, on the device. Nothing in the shipped build carries one, and `just store` refuses to zip a bundle that does

## License

MIT. See [LICENSE](LICENSE).
