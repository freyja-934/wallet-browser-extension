# SHIP-9 — Packaging, performance, listing, and repo presentation

## Goal

Ship a zip under 2 MB that paints fast, a manifest with nothing unused, a listing that matches the product, and a README that tells the truth about keyless mainnet.

## Context

- The store zip is 19.5 MB: `public/media/bg-video.mp4` (9.2 MB, 1280×720 H.264, decoded on every popup open), `nft-video.mp4` (3.8 MB), `nft-img.png` (2.5 MB), `token-img.png` (2.7 MB); only `scripts/mint-cinder.mjs` (line 10 reads `public/media`) uses the last three.
- The popup statically imports about 920 KB of minified JS including the BIP39 wordlist; `modulePreload` is off; the vendor chunk is named after `encryption-simple.ts`; `approve.html` loads the full popup chunk.
- `buffer-polyfill` is imported first in `service-worker.ts` but bundled code can reference `Buffer` before it evaluates; `copy:icons` duplicates Vite's `publicDir` copy; `.DS_Store` files are copied into `dist/`; the version lives in `package.json`, `manifest.json`, and (until SHIP-8a) `constants.ts`; `just store` overwrites `dist/` with the mainnet build; `outDir` is hardcoded in three Vite configs and two `cp` scripts.
- Manifest: `web_accessible_resources` still exposes `assets/*`; `clipboardWrite` may be unnecessary; the CSP is the bare default.
- Listing: screenshots come from SHIP-0 item 8 (owner); the 128 px icon has no padding; promo tile text is clipped; `listing.md` names categories that no longer exist and omits account prerequisites; the privacy policy omits the solana.fm hand-off and third-party image hosts.
- README describes a public-RPC fallback that 403s and a preview feature that was inverted; AGENTS.md wording per the SHIP-7b decision; commit history before SHIP-1 is what it is (no rewrite).

## Steps

1. Files: `public/media/*`, new `scripts/assets/*`, `scripts/mint-cinder.mjs`, `src/components/ui/Atmosphere.tsx`
   Move `nft-img.png`, `nft-video.mp4`, `token-img.png` to `scripts/assets/` and point `mint-cinder.mjs` line 10 there. Re-encode `bg-video.mp4` with ffmpeg to a 380×600 crop at about 600 kbps, under 1 MB (if ffmpeg is unavailable, replace the video with the still `bg-img.jpg` and say so); `Atmosphere.tsx` keeps the reduced-motion path.
   Verify: `just ext`; `du -sh dist`.

2. Files: `vite.config.ts`, `src/popup/App.tsx`, `src/components/Dashboard.tsx`
   `manualChunks` for `@solana/*`, `react`/`react-dom`, and `bip39`; `React.lazy` + `Suspense` for `WalletCreationFlow` (from `App.tsx`) and `Settings` (from `Dashboard.tsx`) so `bip39` leaves the popup entry.
   Verify: `just ext`; `grep -L abandon dist/popup.js` (the wordlist is gone from the entry); popup entry under 300 KB gzipped from the Vite summary.

3. Files: `vite.config.ts`, `vite.content.config.ts`, `vite.injected.config.ts`, `src/background/service-worker.ts`
   All three configs read `process.env.CINDER_OUT_DIR ?? 'dist'`; the polyfill becomes a separate `rollupOptions.input` entry evaluated first (or an `output.banner` for the worker chunk); `.DS_Store` excluded via a small copy plugin filter.
   Verify: `just ext`; `CINDER_OUT_DIR=dist-store just ext` writes to `dist-store/`; the worker starts without a `Buffer is not defined` error in `just e2e e2e/smoke.spec.ts`.

4. Files: new `scripts/sync-version.mjs`, `package.json`, `justfile`, `.gitignore`
   `sync-version.mjs` writes the `package.json` version into `<outDir>/manifest.json`; `package.json` scripts: `copy:manifest` runs the sync, `copy:icons` removed, all `dist/` paths use `${CINDER_OUT_DIR:-dist}`; `just store` exports `CINDER_OUT_DIR=dist-store` so `dist/` keeps the devnet build; `.gitignore` adds `dist-store`.
   Verify: `just store` zip under 2 MB; `dist/` untouched by it.

5. Files: `manifest.json`, `docs/store/listing.md`, `docs/legal/privacy.md`, `public/legal/privacy.html`
   Drop `assets/*` from `web_accessible_resources`; drop `clipboardWrite` if `navigator.clipboard.writeText` inside the copy buttons still works (verify in `just e2e e2e/receive.spec.ts`); CSP adds `img-src 'self' https: data:; media-src 'self'`. Listing: current categories, account prerequisites, Pages privacy URL (`…/legal/privacy.html`), permission justifications for publicnode and the optional host permission. Privacy: solana.fm explorer hand-off and third-party NFT/token image hosts named.
   Verify: `just check`; `just e2e e2e/receive.spec.ts e2e/dapp.spec.ts`.

6. Files: `scripts/generate-icons.mjs`, `public/icons/*`, `src/config/brand.ts`
   Regenerate icons from `CINDER_MARK_SVG` with 10 percent padding at 16/32/48/128.
   Verify: `just ext`; icons render in `chrome://extensions`.

7. Files: `README.md`, `docs/README.md`, `CHANGELOG.md`
   README: what the store build does keyless (SOL balance, send, history) versus with a custom RPC or Helius key (tokens, NFTs, metadata), a Known limitations section (localnet, keyless tokens, Chrome 111+), the architecture block updated for router, protocol, connected origins, MAIN-world injection, and honest feature claims. `docs/README.md` lists the new docs. `CHANGELOG.md` 0.3.0 entry finalised.
   Verify: every command in the README runs.

8. Files: `AGENTS.md`, `.github/pull_request_template.md`, `docs/plans/*`
   AGENTS.md: the popup/mnemonic rule per the SHIP-7b wording, commands unchanged; PR template checklist line reworded to "AI-assisted — I have read and understand every line"; plans moved to `docs/history/` or kept per the SHIP-0 decision (default: keep, add a one-line index in `docs/README.md`).
   Verify: `just check`.

Owner follow-ups written into this plan for `.github/workflows/check.yml`: a `store` job running `just store` and uploading `cinder-wallet-store.zip` as an artifact; a `e2e` job with `pnpm exec playwright install --with-deps chromium` and `just e2e` (needs a funded devnet fixture or a skip flag for the send test). Tag `v0.3.0` after merge.

## Out of scope

- History rewrite.
- New screenshots (owner, SHIP-0 item 8).

## Risks

- Removing `clipboardWrite` could break copy in the toolbar popup context; the e2e covers the popup-as-tab case only, so verify manually in the real toolbar popup before dropping it.
- Lazy loading adds a Suspense fallback on first open of create/import; keep it under the atmosphere frame so it does not flash.

## Parking lot

- Firefox MV3 port.
