# SHIP-7b — Keyring, session, and accounts

## Goal

Version the vault and raise the KDF cost, stop secrets from crossing Redux, make auto-lock idle-based, fix the onboarding inputs that lie, and expose the multi-account support the keyring already has.

## Context

- The vault blob has no version or KDF parameters; PBKDF2-SHA256 runs 100k iterations. `changePassword` enforces only 8 characters and leaves `lumen_vault` encrypted with the old password. `unlock` resets `activeAccountIndex` to 0. `exportSeed`, `exportPrivateKey`, and `changePassword` each decrypt twice.
- Since SHIP-5 the session store throws without `chrome.storage.session`, `lock()` rejects pending approvals and emits the `locked` event, `touchActivity()` re-arms the alarm, and `minimum_chrome_version` is 111 (SHIP-6).
- Auto-lock is a fixed countdown from unlock; nothing re-arms it on use.
- `walletSlice` thunks carry the password and mnemonic in action payloads (`createWallet`, `unlockWallet`, `changePassword`, `exportSeedPhrase`, `exportPrivateKey`); `store.ts` ignores `payload.keypair` that no longer exists. Paste import rejects phrases with extra whitespace or capitals; the "I stored this phrase" checkbox is `readOnly` and auto-checks on reveal.
- `keyring.switchAccount` exists; `unlock` derives `max(payload.accounts.length, 1)` accounts from the vault payload, so accounts added without re-encrypting the vault would disappear.

## Steps

1. Files: `src/lib/encryption-simple.ts`, `src/lib/encryption-simple.test.ts`, `src/background/keyring.ts`, new `src/background/keyring.test.ts`, new `docs/adr/0002-vault-v2.md`
   Vault v2: `{ version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 }, salt, nonce, ciphertext }`; `encrypt` writes v2, `decrypt` reads v1 (no `version`, 100k) and v2 by their own parameters. `keyring.ts`: `decryptVault` returns the payload plus the vault version; `unlock` re-encrypts a v1 vault as v2 after a successful decrypt, writes the new blob before removing `lumen_vault`, and preserves `activeAccountIndex`; a private `unlockWithPayload(payload)` lets `exportSeed`, `exportPrivateKey`, and `changePassword` derive the key exactly once; `changePassword` enforces `validatePasswordStrength`. Tests (chrome stub): create → lock → unlock; v1 fixture → unlock → stored blob is v2 and unlocks again; wrong password; tamper detection; salt and nonce differ between encrypts; change-password rejects weak passwords. ADR records the iteration count, the measured cost (about 0.15 s on a laptop, up to 1 s on low-end hardware), and the migration.
   Verify: `just test src/background/keyring.test.ts src/lib/encryption-simple.test.ts`; `just check`.

2. Files: `src/background/keyring.ts`, `src/background/router.ts`, `src/lib/protocol.ts`, `src/popup/App.tsx`
   Idle auto-lock: `touchActivity()` re-arms the alarm on every extension-page message (already called from the router since SHIP-5); the alarm fires only when no activity happened for the configured minutes. Accounts: `cinder_accounts` (public) is the source of truth for the account list; `ADD_ACCOUNT` derives the next index and appends; `RENAME_ACCOUNT { index, name }`; `SWITCH_ACCOUNT` emits the SHIP-5 change event; `unlock` derives from the stored account count. `App.tsx` re-runs `initializeWallet()` on the `locked` event (from SHIP-5) and shows the unlock screen.
   Verify: `just check`; `just e2e e2e/settings.spec.ts`.

3. Files: `src/components/wallet/SeedPhraseImport.tsx`, `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/WalletCreationFlow.tsx`
   Paste import normalises whitespace and case before validating; the attestation checkbox is a controlled input the user must tick to continue; create and import call `extensionClient.createWallet` directly and dispatch `initializeWallet()` afterwards; the mnemonic lives only in component state during onboarding.
   Verify: `just check`; `just e2e e2e/create.spec.ts e2e/wallet.spec.ts`.

4. Files: `src/components/settings/Settings.tsx`, `src/store/slices/walletSlice.ts`, `src/store/slices/walletSlice.test.ts` (new), `src/store/store.ts`
   Settings export and change-password call `extensionClient` directly; `walletSlice` keeps `initializeWallet`, `lockWallet`, `clearWalletData`, and public-state reducers only; the secret-carrying thunks are deleted; `store.ts` drops the `payload.keypair` ignore list. Test: dispatching every remaining thunk never puts a string containing the fixture password or mnemonic into an action.
   Verify: `just check`; `just e2e e2e/settings.spec.ts`.

5. Files: new `src/components/wallet/AccountSwitcher.tsx`, `src/components/shell/AppShell.tsx`, `src/messaging/client.ts`, `e2e/settings.spec.ts`
   Header account switcher: list accounts, switch, add, rename; export private key uses the selected index. e2e: add a second account, switch to it, the header address changes, export shows the second key prompt.
   Verify: `just check`; full `just e2e`.

## Out of scope

- Hardware accounts.
- Light theme.

## Risks

- Vault v2 migration touches every existing user's data; the test suite covers v1 → v2 and a second unlock, and the new blob is written before the old key is removed.
- 600k iterations makes unlock slower on low-end hardware; the unlock button shows a spinner and the ADR states the expectation.
- Deleting thunks changes the popup's error paths; the e2e for create, import, unlock, settings are the gate.

## Parking lot

- Argon2 is excluded by AGENTS.md; revisit if the rule changes.
