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

## Consequences

- **Cost.** Measured on an Apple M1 Max (Node 20 WebCrypto, the same
  implementation Chrome uses): 100k iterations ≈ 22 ms, 600k ≈ 131 ms per
  derivation, averaged over five runs. Low-end hardware is several times slower;
  budget up to about 1 s there. Unlock, export, and change-password each derive
  the key once (`unlockWithPayload` exists so export and change-password do not
  decrypt twice), and the unlock button shows a spinner while it runs.
- An unlock that migrates pays for one extra derivation — once, ever.
- A vault written by this build cannot be read by an older build. That is the
  point of the version field, and there is no downgrade path.
- Raising the count again is a one-line change to `CURRENT_KDF` plus a bump of
  `CURRENT_VAULT_VERSION`; old blobs keep opening with their own parameters.
