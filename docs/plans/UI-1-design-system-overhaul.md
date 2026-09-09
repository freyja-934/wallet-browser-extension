# UI-1 — Design system and popup overhaul

## Goal

Give Lumen one visual language and then restyle every popup and approval screen so the wallet feels like a finished product: calm, precise, and easy to use in a 380×640 Chrome popup.

Done when:

- Tokens, type, spacing, motion, and primitives live in one design system (not per-page one-offs).
- Every user-facing screen uses those primitives.
- Dead or misleading controls are removed or actually wired.
- `just check` is green and `just ext` still loads.

## Context

Reviewed from source (popup, approval window, primitives, tokens, onboarding). Interactive click-through of the loaded extension was not possible in this session because the popup talks to `chrome.runtime`.

### What exists today

A dark Tailwind theme is already sketched in `tailwind.config.js` (`bg-0/1/2`, `fg-0..3`, Solana brand stops, cyan focus). `Button`, `Card`, `TextField`, `Modal` use it. The home shell, assets, NFTs, activity, settings, send, receive, and approval screens are mostly on that theme.

Onboarding is a different product: `PasswordCreate`, `SeedPhraseDisplay`, `SeedPhraseVerification`, `SeedPhraseImport`, and `ErrorBoundary` still use light-mode grays and indigo buttons (`text-gray-900`, `bg-indigo-600`). They sit inside `.popup-container` which is `#0B0B0C`. Create/import after the welcome card is a light form on a black canvas.

`Inter` is named in Tailwind and never loaded. The CSS mentions `.radix-themes` but Radix is not a dependency. Brand on unlocked screens is the public Solana purple–green–cyan gradient, while the product name is Lumen.

### Screen-by-screen

**Loading** (`LoadingScreen`) — Pulsing Solana-gradient ring. No wordmark. Fine as a splash; it should look like Lumen, not a spinner demo.

**Welcome** (`WalletCreationFlow` choice) — Title is “Solana Wallet”, not Lumen. Empty gradient circle as logo. Dead “Terms of Service” line. Two stacked buttons, no hierarchy beyond Primary/Secondary.

**Reveal seed / verify / import / create password** — Light tutorial UI. Seed copy-per-word is easy to leak. Verify allows pasting the whole phrase (defeats the check). Import has good paste vs manual UX, then indigo styling. Password strength uses raw `bg-red-500` / indigo, not tokens. No step indicator (1 of 4).

**Unlock** — On-theme, but a lock icon in a gradient disc, duplicate errors (toast + inline), “Forgot password?” only toasts, “Contact Support” is `#`. Password field is a custom overlay, not a system primitive.

**Home / Assets** — Sticky header + sticky 4-text tabs burn vertical space. Settings is a peer of Assets/NFTs/Activity (wrong IA). Address is truncated with no copy. Network pill always says Mainnet and does nothing. Balance is a small card (“Portfolio” under a huge USD number; SOL tucked to the right). Send/Receive are full-width buttons. Asset rows are decent; clicking any asset opens generic Send without preselecting the token. Search is a full-height field above a card that also says “Assets”. `hideSmallBalances` is in Redux and never exposed.

**NFTs** — Same search pattern. Grid is fine. List mode exists in state; `NFTCard` is always a tile, so list view does not list. Collection filter chips use purple `brand-a`. Empty state is one gray sentence. Detail modal: emoji fallback, raw collection key, “Send” toasts “coming soon”.

**Activity** — Filter chips `all` / `sent` / `received` (sentence case, no labels). Amount has no ticker. Status color is on the timestamp, not the status. Empty state is one line. Opens SolanaFM in a tab (ok).

**Settings** — Usable sections, cramped in a tab. RPC `<select>` does not change `getRpcUrl()` (always mainnet). Theme and hide-small-balances exist in settings types and are not on this screen. Wipe uses `window.confirm`. Seed/private-key reveal then offer Copy with no hold-to-copy / second confirm. Version string is hardcoded `0.2.0`.

**Send modal** — Centered modal in 380px. Native `<select>` for tokens. USD toggle and fee dropdown in `AmountInput` do not change the amount or the fee. Review truncates the destination (`abcd...wxyz`) — dangerous. Ack checkbox is good. `step: 'select'` is unused.

**Receive modal** — Token `<select>` does not change the address (SPL and SOL share the owner address — the control implies otherwise). QR is good. Share uses `navigator.share` (often missing in extension popups) with no fallback.

**Approval window** (`approve.html`, 400×680) — Highest-trust surface, currently a dump: type enum, origin, simulation logs, compute units. Approve and Reject are equal visual weight. No account, no amount hierarchy, no origin favicon/host emphasis, no “this can move funds” treatment for `signAndSendTransaction`.

**Error boundary** — Light “Oops!” page, indigo button. Breaks the dark popup if anything throws.

### UX problems that are not paint

1. **Two themes.** Dark home + light onboarding.
2. **Borrowed identity.** Solana gradient + Inter-that-isn’t + indigo leftovers. Not Lumen.
3. **IA.** Four top tabs; Settings is not a wallet tab. Primary actions compete with the balance.
4. **Dishonest controls.** Network, RPC, fee speed, USD mode, Contact Support, Terms, NFT Send, Forgot password.
5. **Modals in a popup.** Centered overlay + `px-6` headers waste the 380px frame. Sheets fit thumbs better.
6. **Truncated addresses on confirm.** Review and receive show shortened keys without a full-address expand.
7. **No shared primitives for** icons, sheets, empty states, skeletons, password fields, address rows, segmented controls.
8. **A11y.** Duplicate SVGs, no focus trap documented on Modal, `prefers-reduced-motion` missing, native selects, emoji as NFT fallback.

### Constraints we will not break

- Popup never holds a `Keypair`. Chain data stays on React Query. Redux stays lock / accounts / modal flags.
- Do not invent portfolio deltas or “available %”.
- Integer lamports / token units in send logic (`toSmallestUnit`). Display may format; do not `amount * LAMPORTS_PER_SOL`.
- Route on `hasVault`. Approvals stay `chrome.windows.create`.
- No new npm UI kit (no Radix Themes, no shadcn) unless you approve a dependency.
- Self-host fonts. Extension CSP is `script-src 'self'`; Google Fonts CDN is the wrong path.
- Ask before `package.json` / config edits. This plan **does** need `tailwind.config.js` (and possibly `index.html` / `approve.html` for font preload). That is called out in step 1.

## Design system — “Lumen Wave”

Futuristic dark exchange: near-black canvas, burnt-orange action, purple–orange flowing light as atmosphere. Matches the attached CoinHub-style references.

**Color**

| Token | Hex | Role |
| --- | --- | --- |
| `bg.0` | `#010000` | Canvas |
| `bg.1` | `#171413` | Elevated / glass |
| `bg.3` | `#483c35` | Warm depth |
| `fg.0` | `#ebeae9` | Primary text |
| `fg.2` | `#959190` | Secondary |
| `brand.b` | `#d1671f` | CTA fill |
| `brand.a` | `#ff7b16` | Hot glow / hover |
| Glow inners | `#ff7b16`, `#ed690b`, `#773506` | `.glow-square` |

**Atmosphere.** Home (tokens tab) loops `public/media/bg-video.mp4`. Unlock, welcome, loading, and the other tabs use the soft purple–orange `bg-img.jpg`. Popup is a fixed 380×640 frame (never `100vh`). `prefers-reduced-motion` always uses the still.

**Type.** Self-hosted Sora + IBM Plex Mono.

**Layout.** Bottom nav (Home / NFTs / Activity). Settings from the header. Sheets from the bottom. Capsule buttons. Glass panels.

**Space and radius**

- 8px grid. Popup padding 16px. Section gap 16px. Row height ~52px.
- Radius: controls 10px, sheets 16px top, pills full. Slightly tighter than today’s 12/16 so it reads as an instrument.

**Elevation**

- Hairline border + 8px soft shadow. No heavy glassmorphism. Header: `bg.0` at ~92% with backdrop blur is enough.

**Motion**

- `fast` 120ms, `base` 180ms, `slow` 280ms, `ease-out`.
- Sheets: slide up. Screens: 8px fade/slide.
- `@media (prefers-reduced-motion: reduce)` → no transform, opacity only.

**Layout (IA change)**

```
┌─────────────────────────────┐  380 × 640
│ [mark] Account ▾    🔒      │  header: copyable account, lock
│                             │
│      12.40 SOL              │  hero: SOL primary, USD secondary
│      $1,842.00              │  no fake 24h delta
│   (  Receive     Send  )    │  two icon+label actions
│                             │
│  Assets list…               │
│                             │
│ Home    NFTs    Activity    │  bottom tabs
└─────────────────────────────┘
```

Settings is a header control (gear), not a tab. Send/Receive are sheets from the bottom, not centered modals.

**Primitives to standardize**

| Primitive | Replaces |
| --- | --- |
| `Button` (primary / secondary / ghost / danger) | Ad-hoc indigo, gold gradient, gray-300 |
| `IconButton` | Header lock, refresh, close |
| `TextField` + `PasswordField` | Unlock/settings overlays |
| `AddressText` (full + copy + optional truncate with expand) | `slice(0,4)` everywhere |
| `Sheet` (bottom, focus trap, Esc) | `Modal` in the popup |
| `SegmentedControl` | USD/SOL, paste/manual, activity filters |
| `ListRow` | AssetRow / TransactionRow / SettingRow |
| `EmptyState` | One-line gray empties |
| `Skeleton` | CSS spinners |
| `Banner` (warning / danger / info) | orange-50 / red-50 / emoji warnings |
| `Icon` (inline SVG set) | Copied path blobs |
| `StepHeader` (back + 1/4) | Onboarding without progress |

**Honesty rules for controls**

- If it does not work, do not show it: RPC network switch, fee speed, USD amount toggle, Contact Support, Terms `#`, NFT Send, decorative Mainnet pill.
- `Forgot password?` becomes “Restore with seed phrase” only if we add that flow; otherwise omit it (parking lot).
- Receive: one address, label “Your Solana address”. Token picker is optional decoration — default off.
- Send review: **full destination address**, copy, network fee from real lamports, token preselected from the row that opened Send.

**A11y baseline**

- Contrast AA on `fg.0`/`fg.1` vs `bg.0`/`bg.1`.
- Focus ring `0 0 0 3px` gold at 35% opacity.
- Icon buttons have `aria-label`.
- Sheets trap focus and restore it.
- Seed and private key are `user-select` isolated; copy is explicit and warned.

## Steps

1. Files: `docs/adr/0001-aperture-design-system.md`, `tailwind.config.js`, `src/styles/index.css`, `index.html`, `approve.html`  
   **Needs your OK to edit `tailwind.config.js` and the two HTML entry files.**  
   Record the Aperture tokens, type, motion, and IA in an ADR. Replace theme colors, shadows, radii, font families. Self-host Fraunces + IBM Plex (Sans + Mono) under `public/fonts/` and preload from both HTML entries. Drop `.radix-themes` and `.grad-solana`. Add reduced-motion utilities. Copy `public/fonts` in `just ext` only if the existing copy:icons path is insufficient — if `vite` already emits `public/`, do not touch `package.json`.  
   Verify: `just check`

2. Files: `src/components/ui/Button.tsx`, `src/components/ui/Input.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Modal.tsx`, `src/components/ui/Icon.tsx` (new)  
   Restyle primitives onto tokens. `Modal` becomes a bottom `Sheet` in the popup (keep a centered variant for the wider approval window if needed). Add `PasswordField`, `SegmentedControl` in Input. `Icon` covers lock, send, receive, copy, check, warning, close, gear, search — no new icon package.  
   Verify: `just check`

3. Files: `src/components/ui/EmptyState.tsx` (new), `src/components/ui/Skeleton.tsx` (new), `src/components/common/ErrorBoundary.tsx`, `src/popup/App.tsx`  
   Shared empty/skeleton/banner patterns. Error boundary on Aperture dark theme. Toast styles in `App.tsx` use tokens (no leftover `#111214` / cyan).  
   Verify: `just check`

4. Files: `src/components/shell/AppShell.tsx`, `src/components/Dashboard.tsx`, `src/store/slices/uiSlice.ts`  
   Header: mark, account chip (truncated with copy; full address on click), lock, settings gear. Bottom nav: Home / NFTs / Activity. Remove Settings tab (`activeView` drops `'settings'`). Settings renders as a full-screen panel from the gear (`showSettings` already exists). Hero balance + Receive/Send sit on Home only, not on NFTs/Activity.  
   Verify: `just check`

5. Files: `src/components/wallet/WalletCreationFlow.tsx`, `src/components/wallet/PasswordCreate.tsx`, `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/SeedPhraseVerification.tsx`, `src/components/wallet/SeedPhraseImport.tsx`  
   Entire onboarding on primitives + `StepHeader`. Title is Lumen. Numbered seed grid, reveal-to-view, **do not encourage per-word copy**; one “Copy all” behind a confirm. Verification: no full-phrase paste auto-fill. Import: `SegmentedControl` for paste/manual and 12/24. Password: `PasswordField` + tokenized strength meter. Remove Terms until a real URL exists.  
   Verify: `just check` (keep existing `data-testid`s on password/import)

6. Files: `src/components/wallet/UnlockScreen.tsx`, `src/components/common/LoadingScreen.tsx`  
   Wordmark + short password form, one error surface (inline, not toast+inline). Drop fake support link. Loading: static gold ring + “Lumen”, no ping-pong gradient.  
   Verify: `just check`

7. Files: `src/components/wallet/BalanceCard.tsx`, `src/components/tokens/TokenList.tsx`, `src/components/tokens/AssetRow.tsx`  
   Hero: SOL large (Fraunces, tabular), USD secondary. No invented delta. Token list without nested “Assets” header duplication; search as a quieter field or filter icon. `AssetRow` uses `ListRow`. Clicking a token opens Send **with that mint preselected**. Skeleton rows while React Query loads.  
   Verify: `just check`

8. Files: `src/components/tokens/SendModal.tsx`, `src/components/tokens/ReceiveModal.tsx`, `src/components/tokens/ReceiveCard.tsx`, `src/components/tokens/AmountInput.tsx`  
   Sheets. Remove USD toggle and fee `<select>` until they are real. Review shows **full** recipient via `AddressText`, fee as lamports formatted with `formatLamports` (no float `1e9` display math beyond existing helper). Receive: single address + QR + copy; Share only if `navigator.share` exists. Preselect token from step 7.  
   Verify: `just check`

9. Files: `src/components/nfts/NFTGallery.tsx`, `src/components/nfts/NFTCard.tsx`  
   Gallery on tokens. Real list layout when `nftViewMode === 'list'`. EmptyState with “No collectibles”. Detail sheet: image, name, collection name (not raw key), compressed badge. Remove Send until transfer exists.  
   Verify: `just check`

10. Files: `src/components/transactions/TransactionHistory.tsx`, `src/components/transactions/TransactionRow.tsx`  
    Segmented All / In / Out. Amount + symbol. Relative time and status as separate fields. EmptyState. Keep SolanaFM click.  
    Verify: `just check`

11. Files: `src/components/settings/Settings.tsx`, `src/components/ui/ConfirmDialog.tsx` (new)  
    Full-screen settings from the shell gear. Wire `hideSmallBalances` (and threshold if already in `WalletSettings`) via `extensionClient.updateSettings`. Auto-lock stays. Remove RPC/network `<select>` until the worker uses `NETWORKS`. Replace `window.confirm` with `ConfirmDialog`. Seed/private-key: password → reveal → copy behind a second confirm; no auto-copy. About: `WALLET_VERSION` from constants, drop dead Terms/Privacy/GitHub or point at the real repo URL only if you supply it.  
    Verify: `just check`

12. Files: `src/components/transactions/ApprovalScreen.tsx`, `src/popup/approve-main.tsx`  
    Approval as a high-trust instrument: origin host first, then kind in human words (“Connect”, “Sign message”, “Send transaction”), then simulation summary (success/fail, warnings as `Banner`, instruction list collapsed by default). Sticky Reject / Approve. Approve is primary gold; for `signAndSendTransaction` keep it enabled but visually secondary to the warning banner if `preview.warnings` contain `danger`. Preserve `data-testid`s (`approval-preview`, `approval-approve`, `approval-reject`).  
    Verify: `just check`

13. Files: `src/styles/index.css`, `src/components/shell/AppShell.tsx`, `src/components/ui/Modal.tsx`  
    Focus trap + Esc on sheets, skip-link not required in a popup. Hit targets ≥ 40px. Scrollbars on tokens. Keyboard: Unlock submit, Send continue.  
    Verify: `just check` and `just ext`

## Out of scope

- New npm dependencies, Radix, shadcn, icon packs.
- Light theme (tokens may allow it later; ship dark only).
- Real network/RPC switching, custom RPC, fiat conversion, priority fees, NFT transfer, multi-account create, forgot-password restore.
- Test dApp chrome (`examples/test-dapp`).
- Figma library (can follow; this plan is in-product).
- Copy of seed into telemetry or logs.
- Changing Wallet Standard / message API, keyring, or `package.json` scripts unless step 1 proves fonts are not copied (then we ask).

## Risks

- **Config permission.** Step 1 needs `tailwind.config.js` + HTML font preload. Without that, tokens stay inconsistent.
- **Font weight.** WOFF2 files in `public/fonts/` increase the unpacked size; subset Latin only.
- **Sheet vs tests.** Approval tests that look at `data-testid` must keep those ids.
- **Vertical space.** Bottom nav + hero can crowd assets; keep hero compact (one SOL line, one USD line, two 44px actions).
- **Scope creep.** Wiring RPC or USD mode looks like UI work; it is product/backend. Honesty rule exists to stop that.
- **Onboarding verify paste.** Removing full-phrase paste is a behavior change; call it out in the PR.

## Parking lot

- Restore-from-seed when password is forgotten (needs a locked-vault import path).
- Account switcher (`SWITCH_ACCOUNT` exists on the worker; `extensionClient` does not wrap it yet).
- Connected dApp list / permissions.
- Priority fee estimator and USD entry once prices are trusted.
- Network switch once `getRpcUrl()` reads settings.
- Figma tokens file mirroring Aperture.
- Address book / recent recipients.
- Transaction detail sheet in-popup instead of SolanaFM only.
