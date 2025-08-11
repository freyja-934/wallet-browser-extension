# 🚀 Solana Wallet Extension - Quick Start Guide

## 📦 Installation

1. **Load the Extension**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder from this project
   - The Solana Wallet icon will appear in your extensions bar

2. **Pin the Extension**
   - Click the puzzle piece icon in Chrome toolbar
   - Find "Solana Wallet" and click the pin icon
   - The wallet icon will now be visible in your toolbar

## 🎯 First Time Setup

### Create a New Wallet
1. Click the wallet extension icon
2. Click "Create New Wallet"
3. **Important**: Write down your 12-word seed phrase and store it safely
4. Verify your seed phrase by entering the requested words
5. Create a strong password (min 8 characters)
6. Your wallet is ready!

### Import Existing Wallet
1. Click the wallet extension icon
2. Click "Import Existing Wallet"
3. Enter your seed phrase (12 or 24 words)
4. Create a password
5. Your wallet is imported!

## 💰 Using Your Wallet

### View Balances
- **Tokens Tab**: Shows SOL balance and all SPL tokens with USD values
- Prices update every 5 minutes automatically
- Click refresh button to update immediately

### Send Tokens
1. Click the "Send" button
2. Select token (SOL or any SPL token)
3. Enter recipient address
4. Enter amount
5. Review and confirm transaction

### Receive Tokens
1. Click the "Receive" button
2. Copy your wallet address or show QR code
3. Share with sender

### View NFTs
1. Click the "NFTs" tab
2. Toggle between grid/list view
3. Filter by collection
4. Click any NFT to view details

### Transaction History
1. Click the "Activity" tab
2. View all transactions
3. Filter by sent/received
4. Click any transaction to view on Solscan

## 🔒 Security Features

- **Auto-lock**: Wallet locks after 15 minutes of inactivity
- **Encrypted Storage**: All data encrypted locally
- **Password Protected**: Strong password required
- **Seed Phrase**: Never stored unencrypted

## 🌐 Connecting to dApps

The wallet is Phantom-compatible! When you visit a Solana dApp:
1. Look for "Connect Wallet" button
2. Select "Phantom" or "Solana Wallet"
3. Approve the connection in the popup
4. Start using the dApp!

## ⚙️ Settings & Features

### Managing Accounts
- Create multiple accounts from same seed phrase
- Switch between accounts in wallet header
- Each account has its own address

### Network
- Currently connected to Solana Mainnet
- Powered by Helius RPC for reliability

## 🆘 Troubleshooting

### Extension Not Loading?
- Make sure you selected the `dist` folder (not the project root)
- Check that Developer mode is enabled
- Try refreshing the extension

### Can't See Tokens?
- Refresh balances using the refresh button
- Check you're on the correct account
- Some new tokens may take time to appear

### Transaction Failed?
- Ensure sufficient SOL balance for fees (~0.000005 SOL)
- Check recipient address is valid
- Try again with higher priority fee

### Forgot Password?
- You'll need to reimport using your seed phrase
- Click "Forgot password?" on unlock screen
- Have your seed phrase ready

## 📱 Best Practices

1. **Never share your seed phrase**
2. **Always verify transaction details before confirming**
3. **Keep some SOL for transaction fees**
4. **Regularly check for suspicious activity**
5. **Use a strong, unique password**

## 🎉 You're Ready!

Your Solana wallet is now set up and ready to use. Start by:
- Receiving some SOL to your address
- Exploring Solana dApps
- Collecting NFTs
- Swapping tokens (coming soon!)

For more features and updates, check the [Implementation Summary](./IMPLEMENTATION_SUMMARY.md).
