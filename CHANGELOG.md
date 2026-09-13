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
  popup-only worker handlers; the content script now copies only the fields each
  dApp message accepts, and sets `type` and `origin` last.
- **SHIP-5** — Approvals are claimed before they are fulfilled and bound to a
  validated requesting origin, so nothing settles a request twice and no site
  sees or signs for an account it was never granted.
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
  open, and hand focus back to the control that opened them.

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
- **SHIP-7a** — A send looks in the ledger before calling itself expired, and
  only one send runs at a time.

---

Releases before 0.3.0 (0.2.0, the first Chrome Web Store build) predate this
file; see the git history.
