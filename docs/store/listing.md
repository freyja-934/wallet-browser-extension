# Chrome Web Store listing (paste)

Build the zip with `just store`. Upload `cinder-wallet-store.zip` (manifest at zip root). Distribution: **Unlisted** until Send and a hosted privacy URL are verified.

You still need a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) (~$5). This file cannot create that account.

## Listing

- **Name:** Cinder Wallet
- **Summary:** Self-custodial Solana wallet with Wallet Standard and transaction preview
- **Category:** Productivity (or Finance if offered)
- **Language:** English
- **Homepage:** https://github.com/freyja-934/wallet-browser-extension
- **Support:** https://github.com/freyja-934/wallet-browser-extension/issues
- **Privacy policy URL (after this file is on GitHub `main`):** https://github.com/freyja-934/wallet-browser-extension/blob/main/docs/legal/privacy.md

Prefer a dedicated GitHub Pages URL once Pages is enabled for this repo:

`https://freyja-934.github.io/wallet-browser-extension/legal/privacy.html`

## Detailed description

Cinder Wallet is a self-custodial Solana wallet for Chrome. Your seed phrase is encrypted on this device with a password you choose. The extension never impersonates another wallet.

You can create or import a wallet, send SOL and tokens, view NFTs, and connect to sites that use Wallet Standard. Approvals open a dedicated window with a simulation preview when the RPC allows it.

Use Mainnet only with funds you can afford to lose. Devnet is for testing.

## Screenshots

Upload from `docs/store/screenshots/` (real popup, 1280×800, full bleed). Store allows 5:

1. `01-unlock-1280x800.png`
2. `02-home-1280x800.png`
3. `03-nfts-1280x800.png`
4. `04-activity-1280x800.png`
5. `05-approve-1280x800.png`

Also required: `promo-small-440x280.png`. Optional: `promo-marquee-1400x560.png`. Icon: `public/icons/icon-128.png`.

Spares if you want to swap one in: `extra-receive-1280x800.png`, `extra-send-review-1280x800.png`. These shots are from the loaded unpacked build (devnet test wallet), not `just store`. `raw/` is local working crops and is gitignored.

## Privacy practices (dashboard)

- Collects: none from a remote Cinder server
- Uses: authentication data (password you enter; not transmitted), user activity on-device (approvals)
- Remote: Solana JSON-RPC (publicnode by default on Mainnet, the public devnet host on Devnet, or a URL / Helius key the user enters in Settings) receives public addresses and signed transactions; CoinGecko receives public mints on Mainnet
- Certify Limited Use

## Permission justifications

- **storage** — Encrypted vault, public account list, and settings stay on this device.
- **alarms** — Auto-lock after the timeout the user chose.
- **clipboardWrite** — Receive → Copy writes the public address after a user click.
- **https://solana-rpc.publicnode.com/*** — Default Mainnet JSON-RPC for balances and send with no key configured; the Solana Foundation host rejects browser origins.
- **https://api.mainnet-beta.solana.com/***, **https://api.devnet.solana.com/*** — Fallback Mainnet JSON-RPC and the Devnet default.
- **https://*.helius-rpc.com/***, **https://api.helius.xyz/*** — Used only when the user enters a Helius API key in Settings, for token names, NFTs, and enriched history. The key is stored on the device and never shipped in the build.
- **https://api.coingecko.com/*** — Mainnet USD prices only.
- **optional_host_permissions https://*/*** — Requested at the moment the user saves a custom RPC URL in Settings, scoped to that URL's origin, and removed again if the endpoint fails its health probe. Nothing is requested without that click.
- **Host access / content scripts on https://*/* and http://localhost/*** — Inject Wallet Standard so sites can request connect and sign. No data is sent until the user approves.

## Single purpose

Solana wallet. Not a general “multi-chain” product. Do not mention Phantom.
