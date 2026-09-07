# 🧪 Testing the Settings Features

## Quick Test Guide

### 1. **Load the Extension**
```bash
# Extension is already built and ready in dist/
1. Open Chrome → chrome://extensions/
2. Enable Developer mode
3. Load unpacked → select `dist` folder
```

### 2. **Create a Test Wallet**
1. Click extension icon
2. Create new wallet
3. Save the seed phrase (for testing)
4. Set password: `testpass123`

### 3. **Test Each Setting**

#### ✅ Auto-lock Timer
1. Go to Settings tab
2. Change "Auto-lock after" to 5 minutes
3. Wait 5 minutes or close/reopen extension
4. Wallet should be locked

#### ✅ Change Password
1. Settings → Change Password
2. Current: `testpass123`
3. New: `newpass456`
4. Confirm: `newpass456`
5. Lock wallet and unlock with new password

#### ✅ Export Seed Phrase
1. Settings → Show Seed Phrase
2. Enter password: `newpass456`
3. Verify it matches your saved phrase
4. Test "Copy to Clipboard"

#### ✅ Export Private Key
1. Settings → Export Private Key
2. Enter password: `newpass456`
3. You'll get a base58 private key
4. Save it (can import to Phantom to verify)

#### ✅ Clear Wallet Data
1. Settings → Clear All Wallet Data
2. Confirm the dialog
3. You'll return to welcome screen
4. Re-import with saved seed phrase

## 🔍 What to Verify

### Security Checks
- ❌ Wrong password shows error
- ✅ Correct password shows data
- ✅ Sensitive data can be copied
- ✅ Modals close and clear data

### State Management
- ✅ Settings persist after reload
- ✅ Auto-lock timer works
- ✅ Password change takes effect
- ✅ Clear data removes everything

### UI/UX
- ✅ Clear error messages
- ✅ Success notifications
- ✅ Loading states
- ✅ Responsive design

## 🎯 Expected Results

1. **Password Change**: Can unlock with new password
2. **Seed Export**: Shows correct 12/24 words
3. **Private Key**: Base58 string (87 chars)
4. **Auto-lock**: Locks after set time
5. **Clear Data**: Complete reset

## 🐛 Common Issues

1. **"Invalid password"**: Check caps lock
2. **Auto-lock not working**: Check if extension stays open
3. **Copy not working**: Check browser permissions

## ✨ Success!

If all tests pass, the settings implementation is working correctly. The wallet now has full backup, security, and management capabilities!
