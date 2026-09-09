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

Need at least one 1280×800 or 640×400 PNG of the real popup (Unlock, Home, approval). Capture after Load unpacked on a production zip (`just store`). Icons 16/32/48/128 are already in `public/icons/`.

## Privacy practices (dashboard)

- Collects: none from a remote Cinder server
- Uses: authentication data (password you enter; not transmitted), user activity on-device (approvals)
- Remote: Solana RPC / optional Helius (public addresses and transactions), CoinGecko (public mints on mainnet)
- Certify Limited Use

## Permission justifications

- **storage** — Encrypted vault, public account list, and settings stay on this device.
- **alarms** — Auto-lock after the timeout the user chose.
- **clipboardWrite** — Receive → Copy writes the public address after a user click.
- **https://api.mainnet-beta.solana.com/***, **https://api.devnet.solana.com/***, **https://api.testnet.solana.com/*** — Default JSON-RPC for balances and send.
- **https://*.helius-rpc.com/***, **https://api.helius.xyz/*** — Optional DAS / enhanced RPC when a builder sets a key. Not required.
- **https://api.coingecko.com/*** — Mainnet USD prices only.
- **Host access / content scripts on https://*/* and http://localhost/*** — Inject Wallet Standard so sites can request connect and sign. No data is sent until the user approves.

## Single purpose

Solana wallet. Not a general “multi-chain” product. Do not mention Phantom.
