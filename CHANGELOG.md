# Changelog

Notable changes to Cinder Wallet, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

One line per remediation phase (`docs/plans/SHIP-*`); each phase merged as its
own pull request, and the plan it shipped against is the detailed record.

## [0.3.0] — unreleased

`package.json` still reads 0.2.0: SHIP-9 bumps the version, tags `v0.3.0`, and
cuts the release.

### Security

- **SHIP-1** — A page could override the bridged message type and reach
  popup-only worker handlers; the content script now honours only the outer
  `type` and builds the worker message field by field from the fields that type
  accepts, never spreading the page's payload into it. The worker binds the
  request to the browser's view of the sender, not to any `origin` it carries.
- **SHIP-3** — `just store` refuses to zip a build that carries an API key, so
  a Helius key in the shell or in `.env` cannot reach the Chrome Web Store
  bundle.
- **SHIP-5** — Approvals are claimed before they are fulfilled and bound to a
  validated requesting origin, so nothing settles a request twice and no site
  sees or signs for an account it was never granted.
- **SHIP-6** — A page can no longer have the wallet sign serialized transaction
  bytes as an opaque message: such a signature is a valid transaction
  signature, so `signMessage` refuses anything that decodes as one.
- **SHIP-7b** — The vault carries its own KDF parameters and is written at
  600,000 PBKDF2 iterations (v1 blobs migrate on the next unlock); secrets no
  longer travel through Redux, and a second create is refused rather than
  replacing an existing wallet.

### Added

- **SHIP-3** — RPC endpoints come from settings: a custom HTTPS URL probed for
  its cluster, a Helius key, and rotation with three distinct verdicts.
- **SHIP-4** — Token-2022 holdings, names from on-chain metadata, paged
  activity, and a separate prices query.
- **SHIP-5** — Connected sites in Settings with Revoke, an inline unlock in the
  approval window, and lock, disconnect, account and cluster changes pushed to
  connected pages.
- **SHIP-6** — The Wallet Standard provider is injected as a MAIN-world content
  script; batched sign requests open one approval window, honour the chain and
  send options, and the window shows a simulated balance diff.
- **SHIP-7a** — Fee estimates, rent guards on both sides of a send, checked
  token transfers under the mint's own program, and a priced Review step.
- **SHIP-7b** — Accounts can be added and renamed, and auto-lock is idle-based
  rather than a countdown from unlock.
- **SHIP-8b** — Modals trap Tab and Shift+Tab, focus their first control on
  open and again when the sheet swaps step, hand focus back to the control that
  opened them, and stack: a dialog opened over a sheet owns the keyboard until
  it closes. Each sheet is named by its own heading.

### Changed

- **SHIP-2** — The worker's message handlers moved into an importable router
  behind a typed protocol validated at the boundary, with an in-memory `chrome`
  stub behind the unit tests and a React Query hook for settings.
- **SHIP-4** — The popup shows what it knows: dashes and error cards, never
  zeros or placeholder data, and totals say when they cover SOL only.
- **SHIP-8a** — Each worker arm is checked against its own response type,
  derived state is computed rather than mirrored through effects, and
  `no-explicit-any` is on.

### Fixed

- **SHIP-1b** — `signAndSendTransaction` returns the 64 raw signature bytes;
  System and Token instruction indexes decode correctly; the provider registers
  as Wallet Standard 1.0.0 with a valid icon; an RPC failure reaches the
  approval screen as a decode-only preview instead of a thrown error, and
  Approve stays disabled until the preview settles.
- **SHIP-7a** — A send looks in the ledger before calling itself expired, only
  one send runs at a time, and Review blocks a token send addressed to a token
  account rather than crediting nobody.
- **SHIP-7b** — A recovery phrase is normalised on paste (surrounding quotes
  dropped, case lowered, whitespace collapsed) before BIP39 validation, so a
  phrase from a password manager or a PDF is no longer called invalid; and the
  "I stored this phrase" attestation is a real user action rather than a
  read-only box that ticked itself on reveal.
- **SHIP-8b** — A single RPC blip no longer dead-ends a send: both fee reads
  retry twice with backoff, and the Review pane's fee error and the Amount
  step's balance error each carry a Retry, so "Unavailable" is no longer a
  state the user can only escape by closing the modal.

---

Releases before 0.3.0 (0.2.0, the first Chrome Web Store build) predate this
file; see the git history.
