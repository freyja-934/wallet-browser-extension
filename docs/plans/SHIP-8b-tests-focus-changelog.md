# SHIP-8b — Tests, focus management, changelog

## Goal

Tests that would fail if the wallet broke: keyring, approvals, router, transfers, and the injected wallet exercised through the real modules; component tests where the owner has installed the tooling; a coverage gate; keyboard focus that stays inside modals; a changelog.

## Context

- Since SHIP-2/5/7 there are `router.test.ts`, `approvals.test.ts`, `origins.test.ts`, `keyring.test.ts`, `transfers.test.ts`, and the chrome stub. Gaps: `injected.ts` (page-side protocol, batch mapping, events), migration and tamper cases, approval expiry and window-close through the router, per-origin cap, and the popup components.
- `vite.config.ts` `test.include` is `src/**/*.test.ts` (no `.tsx`); the environment is `node`; per-file `// @vitest-environment jsdom` works only if `jsdom` is installed. SHIP-0 item 6 asks the owner to install `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitest/coverage-v8@1`. If they are not installed when this phase runs, the component tests and coverage threshold are deferred and reported, not faked.
  **Resolved 2026-09-13.** They were not installed when this phase ran, so both were deferred and reported in the PR. The owner then authorised the install, and SHIP-10 (`freyja-934/ship-10-component-tests`) landed the widened `test.include`, the coverage gate at 94 percent lines, `BalanceCard.test.tsx`, `SendModal.test.tsx` and `Modal.test.tsx`. Nothing in this phase is outstanding.
- `Modal.tsx` handles Escape only; focus is not trapped or restored; only the unlock field uses `autoFocus`.
- No `CHANGELOG.md`, no tags.

## Steps

1. Files: `vite.config.ts`, `src/test/chrome-stub.ts`, `src/background/keyring.test.ts`, `src/background/approvals.test.ts`
   `test.include` widened to `src/**/*.test.{ts,tsx}`; `coverage.include` set to `src/background/**`, `src/content/**`, `src/lib/**` with an 80 percent lines threshold (only if `@vitest/coverage-v8` is installed; otherwise skip the coverage block and say so). Stub gains whatever the new tests need (`tabs.query` if used, `windows.get`). Keyring tests add: v1 → v2 migration re-unlock, tamper (flip a ciphertext byte), salt and nonce freshness, idle re-arm. Approvals tests add: expiry sweep, window-close on a resolved id is a no-op, per-origin cap, result deletion on delivery.
   Verify: `just test src/background`; `just check`.

2. Files: `src/background/router.test.ts`, `src/background/transfers.test.ts`, new `src/content/injected.test.ts`
   Router: every arm's locked path, `chain` mismatch, batch enqueue, `CANCEL_APPROVAL` from the page, `REVOKE_SITE` from the popup. Transfers: fee fallback, expiry, Token-2022 threading (extend, do not duplicate). Injected: under a minimal `window` shim (or `// @vitest-environment jsdom` if installed) test `registerWallet` registration, connect with and without `silent`, batch mapping order, 64-byte signature output, `change` on the event message, and that replies with a `type` field are ignored.
   Verify: `just test src/background src/content`; `just check`.

3. Files: `src/components/ui/Modal.tsx`, new `src/components/wallet/BalanceCard.test.tsx`, new `src/components/tokens/SendModal.test.tsx`
   Modal: focus the first focusable control on open, restore focus on close, trap Tab and Shift+Tab. Component tests (only if `@testing-library/react` and `jsdom` are installed): BalanceCard renders the error card on `isError`; SendModal Max fills the integer amount and the decimals error appears for a 10-decimal input. If the dependencies are absent, write the tests anyway behind a top-level `describe.skipIf(!deps)` guard that resolves the packages with `import.meta.resolve` and report the skip.
   Verify: `just check`; `pnpm exec vitest run` lists the `.tsx` files.

4. Files: `e2e/dapp.spec.ts`, `e2e/wallet.spec.ts`, new `CHANGELOG.md`
   e2e: approval timeout (shorten the page timeout via a test-only query flag if needed, otherwise assert `CANCEL_APPROVAL` clears the pending request through the popup), locked-sign flow through `approve.html`, keyboard: Tab from the last control in the Send sheet wraps to the first. `CHANGELOG.md` starts at 0.3.0 with one line per SHIP phase.
   Verify: `just check`; full `just e2e`.

## Out of scope

- Visual regression tests.
- CI configuration (owner).

## Risks

- Coverage thresholds fail the gate if the provider is missing; the step checks for it first.
- Focus trapping must not break the e2e that fills fields by test id.

## Parking lot

- Storybook or a component gallery.
