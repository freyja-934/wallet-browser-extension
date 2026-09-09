# Cinder Wallet Privacy Policy

Last updated: 9 September 2026

Cinder Wallet is a Chrome extension. The seed phrase and private keys are encrypted on the user’s device. There is no Cinder backend that receives seeds, passwords, or private keys.

This page is the public copy for the Chrome Web Store. The same text ships in the extension as `legal/privacy.html`.

## What stays on the device

- Encrypted vault (seed phrase) in `chrome.storage.local`
- Unlocked session seed material in `chrome.storage.session` until lock or browser exit
- Settings (auto-lock, cluster, hide-small-balances)

## What leaves the device

- Public addresses and signed transactions to Solana RPC (public Solana RPC, or Helius if the builder set a key)
- Public mint addresses to CoinGecko for USD prices (mainnet only)
- dApp origins the user approves, which receive public addresses

## What we do not do

- Sell or rent personal data
- Use wallet data for advertising
- Recover a forgotten password or lost seed phrase

## Chrome Limited Use

Browser data is used only to encrypt the vault, show balances, and sign transactions the user approves. It is not transferred except to the RPC and price providers above, and only as needed for those features.

## Contact

https://github.com/freyja-934/wallet-browser-extension/issues
