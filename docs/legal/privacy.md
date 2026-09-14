# Cinder Wallet Privacy Policy

Last updated: 14 September 2026

Cinder Wallet is a Chrome extension. The seed phrase and private keys are encrypted on the user’s device. There is no Cinder backend that receives seeds, passwords, or private keys.

The copy the Chrome Web Store listing links to is `docs/legal/privacy.html`, which GitHub Pages
serves verbatim at `/legal/privacy.html`; the same file ships inside the extension as
`legal/privacy.html` (from `public/legal/privacy.html`). This Markdown is the readable copy in the
repository — Pages does not convert it — so edit `public/legal/privacy.html` and this file together,
then run `node scripts/sync-legal.mjs`.

## What stays on the device

- Encrypted vault (seed phrase) in `chrome.storage.local`
- Unlocked session seed material in `chrome.storage.session` until lock or browser exit
- Settings (auto-lock, cluster, hide-small-balances, and any custom RPC URL or Helius API key entered in Settings)

## What leaves the device

- Public addresses and signed transactions to a Solana JSON-RPC endpoint. With nothing configured, Mainnet uses `https://solana-rpc.publicnode.com` and Devnet uses `https://api.devnet.solana.com`
- A custom RPC URL or Helius API key entered in Settings receives the same public addresses and signed transactions. Both values are stored only in `chrome.storage.local` on the device; Cinder never receives them
- The public wallet address to `https://lite-api.jup.ag` on Mainnet, and only when neither a custom RPC URL nor a Helius API key is configured. The public Mainnet endpoint refuses to list token accounts, so without this the wallet can show SOL only. Jupiter is asked which mints the address holds and what those mints are called; the balances, decimals and token programs shown are read from the Solana endpoint, never from Jupiter. Entering any RPC URL or Helius key in Settings stops the request being made at all, and it is never made on Devnet
- Public mint addresses to CoinGecko for USD prices (mainnet only)
- dApp origins the user approves, which receive public addresses
- Token and NFT images are loaded directly from whatever host the token's own metadata names (commonly IPFS or Arweave gateways, or a project's own server). Those hosts see the request and the device's IP address; Cinder does not choose them and does not proxy them
- Opening a transaction in the explorer hands off to `https://solana.fm` in a new tab, which receives that transaction signature. Nothing is sent there unless the user clicks the link

## What we do not do

- Sell or rent personal data
- Use wallet data for advertising
- Recover a forgotten password or lost seed phrase

## Chrome Limited Use

Browser data is used only to encrypt the vault, show balances, and sign transactions the user approves. It is not transferred except to the RPC, token-list and price providers above, and only as needed for those features.

## Contact

https://github.com/freyja-934/wallet-browser-extension/issues
