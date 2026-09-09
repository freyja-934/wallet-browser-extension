---
paths:
  - "src/lib/**"
  - "src/background/**"
---
- Derive keys with `bip39.mnemonicToSeed`, never `Buffer.from(mnemonic)`.
- Sign messages with `nacl.sign.detached`. Never return `secretKey` slices.
- Do not store the password (`btoa` or otherwise). Session lives in SW memory + `chrome.storage.session`.
- Vault is PBKDF2 + AES-GCM via WebCrypto.
- Never log mnemonics, passwords, or private keys.
