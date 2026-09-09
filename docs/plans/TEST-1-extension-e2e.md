# TEST-1 — Playwright extension click-through

## Goal

A repeatable, agent-runnable click-through of Lumen in a real Chromium that can load MV3 extensions: import → unlock → localhost dApp connect / sign message / sign v0 tx → Receive copy toast.

`just check` stays the fast unit gate. A new `just e2e` owns this path.

## Context

Unit tests and `just ext` are green. The human click-through in branded Chrome 152 was never automated.

Chrome DevTools MCP is the **wrong harness** for this:

- Branded Chrome 152 removed `--load-extension`.
- `--autoConnect` attaches to a daily profile; it cannot reliably install unpacked extensions (and is for debugging a tab you already have, not CI).
- MCP is useful later for ad-hoc debugging, not as the test runner.

The right harness is **Playwright + the Chromium it ships** (`channel: 'chromium'`), which still accepts `--load-extension`. Official pattern: `chromium.launchPersistentContext` (not `browser.newContext`), wait for the MV3 service worker, derive `chrome-extension://<id>/…`.

Do **not** point Playwright at `/Applications/Google Chrome.app`.

Existing surfaces this will drive (no new product APIs):

- Popup routes on `hasVault` in `src/popup/App.tsx` (Create vs Unlock).
- Import path: `WalletCreationFlow` → `SeedPhraseImport` (paste) → `PasswordCreate`. Prefer import over “Create New Wallet”: create runs a random 3-word quiz in `SeedPhraseVerification`.
- Approvals: `chrome.windows.create` → `approve.html` (`ApprovalScreen`). Playwright sees that as a new page in the same persistent context.
- Test dApp: `examples/test-dapp/` on port 5174 (`just dapp` / `vite.dapp.config.ts`). Manifest injects only on `http://localhost/*` and `https://*/*`.
- Receive toast: `ReceiveCard` + `react-hot-toast`.

Password that already satisfies `validatePasswordStrength`: `TestWallet1!` (length ≥ 8, score ≥ 4). Use a **fixed unused BIP39 mnemonic** in the test file, never a funded seed.

Ask-first items (AGENTS.md): new dependency `@playwright/test`, `package.json` / Playwright config, optional CI job. Do not fold e2e into `just check`.

## Steps

1. Files: `package.json`, `playwright.config.ts`, `justfile`  
   Add `@playwright/test`. Config: `channel: 'chromium'`, `webServer` for `just dapp` (or the same Vite command on 5174), `testDir: e2e`. Recipe `just e2e` → `just ext` then `pnpm exec playwright test`.  
   Verify: `pnpm exec playwright --version` and `just e2e` exits 0 with zero tests (or Playwright’s empty-suite behavior). `just check` unchanged.

2. Files: `e2e/fixtures.ts`, `e2e/popup.ts`  
   Fixture launches a persistent context with `--disable-extensions-except` + `--load-extension` pointed at `dist/` (absolute path). Expose `extensionId` from the service worker URL. Helper opens `chrome-extension://<id>/index.html` as a page (toolbar popups are not clickable).  
   Verify: `just e2e e2e/smoke.spec.ts` once step 3 adds it — or a one-liner smoke in this slice that only asserts the service worker URL is `chrome-extension://`.

3. Files: `e2e/wallet.spec.ts`, plus `data-testid`s on `WalletCreationFlow.tsx`, `SeedPhraseImport.tsx`, `PasswordCreate.tsx`, `UnlockScreen.tsx`  
   Import known mnemonic → set `TestWallet1!` → dashboard. Close the popup page, reopen `index.html`, expect Unlock (not Create). Unlock with the same password.  
   Verify: `just e2e e2e/wallet.spec.ts`

4. Files: `e2e/dapp.spec.ts`, `data-testid`s on `ApprovalScreen.tsx`  
   After an unlocked vault: open `http://localhost:5174`, Connect → wait for `approve.html` page → approve. Sign message → approve. Sign v0 transfer → assert preview text then approve.  
   Verify: `just e2e e2e/dapp.spec.ts`

5. Files: `e2e/receive.spec.ts`, `data-testid` on `ReceiveCard.tsx` (and the Receive entry in the dashboard if needed)  
   Unlocked popup → Receive → Copy → expect “Address copied”. Grant clipboard permissions on the extension origin.  
   Verify: `just e2e e2e/receive.spec.ts`

6. Files: `AGENTS.md`, `README.md`, optionally `.github/workflows/check.yml`  
   Document `just e2e`. Keep Chrome Load-unpacked as a manual fallback. CI job is optional and separate from `just check` (needs `pnpm exec playwright install chromium`).  
   Verify: `just check` still green; `just e2e` green locally.

## Out of scope

- Chrome DevTools MCP / `--autoConnect` / branded Chrome 152 as the runner
- Create-new + seed quiz (import covers `hasVault` routing)
- Sending real txs or mainnet funds
- NFT / settings / password-change flows
- Putting Playwright inside `just check`
- GIFs or demo recordings

## Risks

- MV3 service worker can sleep; fixture must wait for `serviceworker` and tolerate a restart mid-test.
- `chrome.windows.create` approval pages can race; wait on `context.waitForEvent('page')` + URL containing `approve.html`.
- Sign-tx uses public mainnet RPC for a 0-lamport self-transfer; preview can fail if RPC is down — assert the approval window opened, treat simulation errors as a soft assertion if needed.
- Headless Chromium + extensions: use Playwright’s `channel: 'chromium'`. If a test flakes headless, run headed once to confirm, then pin the wait.
- `package.json` / CI edits need an explicit yes before this plan is executed.

## Parking lot

- Later: create-new + verify-seed coverage; locked-connect opens Unlock window.
- Playwright as a debug UI (`just e2e --debug`) instead of MCP for extension work.
- Chrome for Testing pinned version if Playwright’s bundled Chromium ever regresses `--load-extension`.
