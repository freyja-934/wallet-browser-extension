# 🔐 Solana Wallet Extension Clone

A simplified, non-custodial browser extension wallet for Solana. This project mimics core wallet functionality such as keypair generation, balance viewing, sending tokens, and transaction history — built using **React**, **TailwindCSS**, **Radix UI**, and **Solana Web3.js**.

This is designed as a Chrome extension (Manifest v3) and showcases deep understanding of wallet architecture, local key management, and Solana transaction flows.

---

## 🧱 Tech Stack

- **React** (Vite or Create React App)
- **TailwindCSS**
- **Radix UI**
- **Solana Web3.js**
- **LocalForage** (encrypted local storage)
- **Chrome Extension API (MV3)**

---

## 🗂 Folder Structure

```
apps/
└── wallet-extension/
    ├── public/
    ├── src/
    │   ├── assets/
    │   ├── background/
    │   ├── components/
    │   ├── content/
    │   ├── hooks/
    │   ├── pages/
    │   ├── storage/
    │   ├── utils/
    │   └── manifest.json
    └── scripts/
```

---

## 🧱 Extension Pages

### `popup.html`
- Connect to injected scripts
- Show balance, send, receive buttons

### `options.html`
- Wallet creation/restore
- Export key
- Change password

### `content.js`
- Communication with dApps via `window.solana`

### `background.js`
- Transaction signing + message handling
- Key management and event relay

---

## 🔧 Architecture Overview

- **Keypair Storage**: Encrypted via password and stored in `indexedDB` using LocalForage
- **Popup UI**: Minimal wallet interface using Radix UI
- **Background Script**: Signs transactions and messages
- **Content Script**: Injects provider object (`window.solana`) for compatibility

---

## 🎨 UI Components (Radix + Tailwind)

- `<BalanceCard />`
- `<SendTokenForm />`
- `<ReceiveAddress />`
- `<TransactionHistory />`
- `<CreateWalletForm />`
- `<UnlockWallet />`

---

## ✅ Features & Acceptance Criteria

### 1. Wallet Generation
- Generates new Solana keypair
- Requires password to encrypt & store

**Acceptance Criteria**:
- [ ] User can create a new wallet with password
- [ ] Keypair encrypted and stored using LocalForage
- [ ] Session locks after timeout or refresh

---

### 2. Unlock & Password Protection
- Users enter password to decrypt keypair
- Lock after timeout or tab close

**Acceptance Criteria**:
- [ ] Incorrect password triggers error
- [ ] Decrypted keypair only available in session memory

---

### 3. Balance & Address Display
- Shows SOL balance
- Copyable wallet address

**Acceptance Criteria**:
- [ ] Wallet balance updates live
- [ ] Click to copy address works

---

### 4. Send Transaction
- Form to send SOL to another address
- Validates balance & address format

**Acceptance Criteria**:
- [ ] Successful transfer returns transaction signature
- [ ] Error displayed on failure

---

### 5. Transaction History
- Lists last 10 transactions using Solana RPC
- Shows tx hash, amount, time

**Acceptance Criteria**:
- [ ] Recent transactions fetched on load
- [ ] Links open in Solana Explorer

---

### 6. dApp Injection Support
- Injects `window.solana` with connect/sign methods
- Compatible with Phantom fallback usage

**Acceptance Criteria**:
- [ ] dApps detect injected wallet
- [ ] `connect` and `signTransaction` work via background relay

---

## ⚙️ How to Run (Cursor)

**1. Install**
```bash
pnpm install
```

**2. Build Extension**
```bash
pnpm build
```

**3. Load in Chrome**
- Open `chrome://extensions`
- Enable "Developer mode"
- Click "Load unpacked"
- Select `dist/` directory

---

## 🛠 Future Features

- Token (SPL) support and balances
- NFT viewer tab
- Ledger support via WebUSB
- Multi-account support

---

## 📎 Live Preview

> Load via `chrome://extensions`

---

## 🧾 License

MIT © YourName