# PROD-3 — Deploy the keyless RPC proxy and check a store build

## Goal

Turn the proxy already written on `cursor/keyless-rpc-proxy-8fc2` (draft PR #30) into a live Mainnet endpoint, then confirm a keyless store build shows SOL, token accounts, and DAS. After that, the zip is ready to upload as the next store version. This does not make the wallet safe to recommend for funds you cannot lose.

## Context

The wallet asks Solana through an RPC server. Free public hosts either reject a browser extension or refuse to list tokens. Helius will answer, but the key cannot ship inside the Chrome zip. `workers/rpc` is the small Cloudflare program that holds that key and forwards only the methods this wallet already calls. The extension ships the Worker URL, nothing else.

Checked 2026-10-06 on this machine:

- The proxy code is committed on `cursor/keyless-rpc-proxy-8fc2` (`70594c8`) and is not on `main`. GitHub Pages serves `main`, so the live privacy URL does not mention the Worker yet.
- `npx wrangler whoami` says Wrangler is not logged in.
- Chrome is controllable, and these three tabs are all on a login wall: the Cloudflare dashboard, the Helius dashboard (signup), and the Chrome Web Store developer console (Google sign-in).
- `.env` exists. That dev key stays there. The Worker gets its own Helius key, entered with `wrangler secret put`, never copied into git or the zip.

What the Worker is: the extension sends a Solana question to `https://cinder-rpc.<cloudflare-account>.workers.dev`. The Worker adds the Helius key and forwards it to `https://mainnet.helius-rpc.com/`. Until that program is deployed, every keyless Mainnet call fails the proxy once, rests it for 30 seconds, and uses publicnode, which can show SOL and cannot list token accounts.

The `freyja-934` in the URL is a guess from the GitHub account. Cloudflare prints the real URL at deploy time. If the middle piece differs, the constant and the manifest permission have to change together before `just store`.

## Steps

1. Files: none in the repo. Review draft PR #30 and merge it to `main`.
   The privacy policy, listing, and ADR on that branch have to be what Pages and the store describe.
   Verify: PR checks green; `https://freyja-934.github.io/wallet-browser-extension/legal/privacy.html` names `cinder-rpc` after Pages rebuilds.

2. Files: `workers/rpc/wrangler.jsonc` (read only). You sign in once; the rest is driven from here.
   In the open Chrome window, sign in to Cloudflare and to Helius. Create a Helius key used only by this Worker, and a budget alert before the monthly credit cap. Then `npx wrangler login` (approve the OAuth tab) and, from `workers/rpc`, `npx wrangler secret put HELIUS_API_KEY` and `npx wrangler deploy`. Do not read `.env` for the key.
   Verify: the deploy log prints a `*.workers.dev` URL. A `getBalance` and a `getTokenAccountsByOwner` through that URL return a result. A `getProgramAccounts` returns method-not-allowed and is not forwarded.

3. Files: `src/config/constants.ts`, `manifest.json`, `docs/adr/0006-keyless-rpc-proxy.md`, `docs/store/listing.md`, `public/legal/privacy.html`
   The printed host is `https://cinder-rpc.casey-722.workers.dev`. Put that origin in `CINDER_MAINNET_RPC` and in `host_permissions`, and use the same host in the ADR, the listing, and the privacy policy. Run `node scripts/sync-legal.mjs` so `docs/legal/privacy.html` matches.
   Verify: `just check`.

4. Files: none unless the popup is wrong.
   `just store`, load `dist-store/` unpacked, and on Mainnet with no RPC URL and no Helius key in Settings read the fixture `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk`: SOL balance, a token-account list, and a compressed NFT if that address has one. Confirm the zip contains the Worker host and no key literal.
   Verify: those three reads succeed in the popup. `just check` if a code fix was required.

5. Files: `package.json`, `manifest.json`, `CHANGELOG.md`
   Needs permission before the version bump. 0.5.0 is already tagged without the proxy, and the store rejects an upload that does not raise the version. Cut 0.5.1, rebuild with `just store`, then with you signed in to the Web Store dashboard paste `docs/store/listing.md` and upload `cinder-wallet-store.zip` as Unlisted. Leave the final Submit click to you.
   Verify: the dashboard shows 0.5.1 and the privacy URL loads the merged policy.

## Out of scope

- An independent audit. Tests are not that review. The README line about not putting Mainnet funds you cannot lose stays.
- Connect sharing every account, including ones created later, with no second prompt.
- Hardware wallets, swaps, staking, NFT transfers, priority fees, Firefox, and a Devnet proxy for CI.

## Risks

- A wrong `workers.dev` host makes every keyless call miss, then rest on publicnode. Step 3 exists so the extension and the manifest follow the URL Cloudflare actually printed.
- Reusing the `.env` key would put the dev credential on a public URL. The Worker key is a new one.
- The Worker URL will be copied out of the extension. The per-IP limit and the Helius alert are what keep the free tier from being spent by strangers.
- Pages will keep serving the old privacy policy until step 1 is on `main`. Do not upload the store zip before that URL mentions the proxy.

## Parking lot

- Per-origin account prompt.
- Paying for an audit before recommending Mainnet funds.
- Custom domain in front of `workers.dev`.
