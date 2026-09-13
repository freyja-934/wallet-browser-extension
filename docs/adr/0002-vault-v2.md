# ADR 0002 — Vault v2: versioned blob, PBKDF2 at 600k

## Context

The vault blob was `{ salt, nonce, ciphertext }` with no version and no record of
how the key was derived. `decrypt` re-derived with whatever the module's
`DEFAULT_CONFIG` said at the time — PBKDF2-SHA256 at 100,000 iterations — so
changing the cost would have made every existing vault undecryptable, and there
was no way to tell an old blob from a new one.

100,000 iterations is below what OWASP recommends for PBKDF2-SHA256 (600,000).
The vault sits in `chrome.storage.local` on disk, so its only protection against
someone who copies the profile is the cost of guessing the password.

`AGENTS.md` rules out Argon2 (no WASM in the worker), so the lever available is
the iteration count, and raising it requires the blob to say which count it was
written with.

## Options considered

1. **Bump the constant in place.** One line, and every existing vault stops
   opening — the user would have to re-import from their seed phrase.
2. **Try both counts on decrypt.** No format change, but every wrong password
   pays for two derivations, and the set of counts to try only ever grows.
3. **Version the blob and record the KDF parameters in it** (chosen). One extra
   object in storage, every blob self-describing, and future parameter changes
   cost nothing at rest.
4. Argon2id via WASM — excluded by `AGENTS.md`.

## Decision

The stored blob is:

```json
{
  "version": 2,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000 },
  "salt": "<hex>", "nonce": "<hex>", "ciphertext": "<hex>"
}
```

- `encrypt` always writes the current version (`CURRENT_VAULT_VERSION`) and
  `CURRENT_KDF`. Salt (16 bytes) and nonce (12 bytes) are freshly random per
  encryption; AES-256-GCM is unchanged.
- `decrypt` derives with the parameters of the blob it is handed, never with a
  module default. A blob with no `version` is v1: PBKDF2-SHA256, 100,000
  iterations. A blob with a `version` must carry a `kdf` this build understands,
  or it is refused with `Unsupported vault format`.
- **Migration.** `keyring.decryptVault` returns the payload and the version it
  read. Any successful decrypt of a blob below the current version re-encrypts
  the same payload under the same password and writes the new blob *before*
  anything else happens in that unlock. A worker that dies mid-unlock therefore
  leaves either the old blob or the new one, both of which open with the
  password the user just typed. There is no separate migration pass and no
  flag: a vault migrates the first time its owner unlocks after this ships.
- `changePassword` rewrites the vault at the current version and enforces
  `validatePasswordStrength` on the new password, the same check the create
  screen applies (the old rule was "at least 8 characters" in the popup only).
  `createWallet` enforces the same rule, and refuses outright when a vault
  already exists: an empty phrase means "generate one", so a create against a
  live vault would replace a wallet its owner has written down with one nobody
  has seen. Starting over goes through Clear all wallet data.
- **Which account is active is public state, and persists.** It is stored beside
  the public account list in `cinder_accounts`, not only in the session, so a
  lock no longer moves the user back to the first account on unlock; the session
  copy stays the live value, and an unlock with no session falls back to the
  stored index, clamped to an account that still exists. A stored index names an
  account's derivation index, never its position in the list.
- **Proving the password is not unlocking.** `exportSeed`, `exportPrivateKey`
  and `changePassword` work from the payload they just decrypted and refresh the
  session only when one was already open; on a locked wallet they answer and
  leave it locked, with no session, no auto-lock alarm, and no `onUnlocked`.
- A blob whose `version` this build does not know, or whose `kdf` it does not
  understand, is refused with `Unsupported vault format` before any derivation,
  and that message reaches the unlock screen and Settings unchanged. Only an
  actual decrypt or parse failure is reported as `Invalid password`.

## Consequences

- **Cost.** Measured on an Apple M1 Max (Node 20 WebCrypto, the same
  implementation Chrome uses): 100k iterations ≈ 22 ms, 600k ≈ 131 ms per
  derivation, averaged over five runs. Low-end hardware is several times slower;
  budget up to about 1 s there. Unlock, export, and change-password each derive
  the key once (`unlockWithPayload` exists so export and change-password do not
  decrypt twice), and the unlock button reads `Unlocking…` and is disabled while
  it runs, so the wait is visible without a separate spinner.
- An unlock that migrates pays for one extra derivation — once, ever.
- A vault written by this build cannot be read by an older build. That is the
  point of the version field, and there is no downgrade path.
- Raising the count again is a one-line change to `CURRENT_KDF` plus a bump of
  `CURRENT_VAULT_VERSION`; old blobs keep opening with their own parameters.
