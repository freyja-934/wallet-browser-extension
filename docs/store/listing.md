# Chrome Web Store listing (paste)

Build the zip with `just store`. Upload `cinder-wallet-store.zip` (manifest at zip root). Distribution: **Unlisted** until Send and a hosted privacy URL are verified.

## Before you can submit

None of this is in the repo; the dashboard blocks the submission until each is done.

1. A [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole), one-off $5 registration fee.
2. 2-Step Verification on the Google account that owns it — the dashboard refuses to publish without it.
3. The trader / non-trader declaration (EU DSA). A personal demo with no revenue is **non-trader**; the account still has to answer it.
4. A verified contact email on the developer account, shown on the listing.
5. A privacy policy at a URL you control. GitHub Pages must be on for this repo (Settings → Pages → branch `main`, folder `/docs`) before the URL below resolves.

## Listing

- **Name:** Cinder Wallet
- **Summary:** Self-custodial Solana wallet with Wallet Standard and transaction preview
- **Category:** Tools. (The old “Productivity” and “Finance” buckets are gone; the current list has no finance category, and Tools is where the other wallets sit. “Privacy & Security” is the reasonable second choice.)
- **Language:** English
- **Homepage:** https://github.com/freyja-934/wallet-browser-extension
- **Support:** https://github.com/freyja-934/wallet-browser-extension/issues
- **Privacy policy URL:** https://freyja-934.github.io/wallet-browser-extension/legal/privacy.html

That URL is the file `docs/legal/privacy.html`, which Pages serves byte-for-byte (an HTML file with no front matter is passed through, not rendered by Jekyll — which is why the policy is published as HTML and not as the `.md` next to it). It needs SHIP-0 item 3 (Pages on, branch `main`, folder `/docs`) and nothing else; open it in a browser and confirm it loads before you paste it, because a reviewer will. Until Pages is on, the only fallback is the file on `main`: https://github.com/freyja-934/wallet-browser-extension/blob/main/docs/legal/privacy.html — that shows GitHub's source view of the page, which a review can reject, so turn Pages on first. The same file ships inside the extension at `legal/privacy.html` (Settings → Privacy policy); `src/config/legal.test.ts` fails if the published copy and the shipped copy drift, and `node scripts/sync-legal.mjs` re-syncs them.

## Detailed description

Cinder Wallet is a self-custodial Solana wallet for Chrome. Your seed phrase is encrypted on this device with a password you choose. The extension never impersonates another wallet.

You can create or import a wallet, send SOL and tokens, view NFTs, and connect to sites that use Wallet Standard. Approvals open a dedicated window with a simulation preview when the RPC allows it.

On Mainnet with no endpoint of your own, Cinder uses a public RPC for balances, sends and history — enough to hold and move SOL. Token names, NFTs and enriched history need an RPC that supports them: add your own RPC URL or a Helius API key in Settings, and they appear. Your key stays on your device. If that public endpoint is unreachable on your network, Cinder tells you so and asks for an endpoint instead of showing a balance it does not know.

Use Mainnet only with funds you can afford to lose. Devnet is for testing.

Requires Chrome 111 or later (the Wallet Standard provider is a MAIN-world content script).

## Screenshots

Upload from `docs/store/screenshots/` (composed from real popup captures at 1280×800). The store allows five:

1. `01-home-1280x800.png` — balance and prices, captured on Mainnet
2. `02-approve-1280x800.png` — the simulated balance change before signing
3. `03-connect-1280x800.png` — what a site can and cannot do, in plain language
4. `04-send-1280x800.png` — a network-quoted fee and the full address
5. `05-tokens-1280x800.png` — named from chain metadata, or shown as the bare mint when a token publishes none

Also required: `promo-small-440x280.png`. Optional: `promo-marquee-1400x560.png`. Icon: `public/icons/icon-128.png`.

Spare, not part of the five: `extra-activity`, `extra-receive`, `extra-settings`.

**How they were made and why two clusters appear.** `node scripts/capture-screenshots.mjs` drives the real
extension and writes `raw/`; `node scripts/compose-store-images.mjs` lays those out. Shots 1 and 4 are Mainnet,
where the fixture holds real SOL and prices resolve. Shots 2, 3 and 5 are Devnet, because the fixture address
cannot pay a Mainnet fee — it was assigned away from the system program by someone using the public test
mnemonic (see `docs/test-wallet.md`), so a Mainnet simulation correctly fails. Both clusters are supported and
the listing text says so; nothing here is staged or mocked.

Captures come from a build with `VITE_HELIUS_API_KEY=` empty, matching what `just store` ships, so
`extra-settings` shows the empty fields a store install actually starts with. The per-image provenance table
and the rule that every composed image is read against its own caption before committing are in
`docs/store/screenshots/README.md`.

## Privacy practices (dashboard)

The form asks what the extension *handles*, not what a server stores, so "we have no backend" is not an answer to it. Tick these in the data-usage checkboxes:

- **Authentication information** — the password the user types and the seed phrase it encrypts. Held on the device; never transmitted.
- **User activity** — approvals, connected sites, and the settings the user chooses. On-device.
- **Financial and payment information** — judgement call, and the safer answer is yes: the extension handles public wallet addresses and signs and broadcasts on-chain transactions. No card, bank or payment credential is ever involved.
- Tick nothing else: no personally identifiable information, health information, personal communications, location, web history, or website content.

Then the three certifications, all of which are true here: data is not sold to third parties, is not used or transferred for any purpose unrelated to the wallet's single purpose, and is not used or transferred to determine creditworthiness or for lending.

- Remote: Solana JSON-RPC (publicnode by default on Mainnet, the public devnet host on Devnet, or a URL / Helius key the user enters in Settings) receives public addresses and signed transactions; CoinGecko receives public mints on Mainnet; token and NFT image hosts named by a token's own metadata receive the image request; solana.fm receives a transaction signature when the user clicks through to the explorer
- Certify Limited Use

## Permission justifications

- **storage** — Encrypted vault, public account list, and settings stay on this device.
- **alarms** — Auto-lock after the timeout the user chose.
- **clipboardWrite** — The Copy buttons write to the clipboard from the toolbar popup: the receive address, the active account address, a token mint, and — behind the password prompt, at the user's request — the recovery phrase. The extension never reads the clipboard (`clipboardRead` is not requested); pasting a phrase on import is the browser's own paste into a field the user focused.
- **https://solana-rpc.publicnode.com/*** — The only Mainnet JSON-RPC used when the user has configured nothing: SOL balance, sending, and history. It is the default because `api.mainnet-beta.solana.com` returns 403 to any request carrying an `Origin` header, which every extension request does; that host is therefore not requested at all. Without publicnode a keyless Mainnet install cannot read a balance. Public addresses and signed transactions only.
- **https://api.devnet.solana.com/*** — The Devnet default, same use.
- **https://*.helius-rpc.com/***, **https://api.helius.xyz/*** — Used only when the user enters a Helius API key in Settings, for token names, NFTs, and enriched history. The key is stored on the device and never shipped in the build.
- **https://api.coingecko.com/*** — Mainnet USD prices only.
- **optional_host_permissions https://*/*** — Not held at install. Chrome asks for it at the moment the user saves a custom RPC URL in Settings, and the grant is narrowed to that one URL's origin; it is dropped again if the endpoint fails its health probe. A user who never enters an RPC URL is never asked.
- **Host access / content scripts on https://*/* and http://localhost/*** — Inject Wallet Standard so sites can request connect and sign. No data is sent until the user approves.
- **Content security policy** — `script-src 'self'; object-src 'self'; img-src 'self' https: data:; media-src 'self'`. `img-src` allows https because token and NFT artwork is fetched from whatever host a token's own metadata names. `media-src 'self'` is deliberate: the only media the extension plays is its own bundled background video and its poster image, and playing remote NFT audio or video is out of scope, so no remote media can load.

## Single purpose

Solana wallet. Not a general “multi-chain” product.
