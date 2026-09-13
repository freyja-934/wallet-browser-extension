# SHIP-8a — Protocol completion and architecture cleanup

## Goal

Finish what SHIP-2 started: an exhaustive typed protocol with `no-explicit-any` on, settings read only through React Query, Redux holding lock and UI state only, no derived-state effects, and no dead exports.

## Context

- After SHIP-2 through SHIP-7 every message type is in `src/lib/protocol.ts`, but `.eslintrc.cjs` still has `@typescript-eslint/no-explicit-any: off` and `any` remains in `src/services/helius.ts`, `src/services/coingecko.ts`, and `src/content/injected.ts` (`Promise<any>` in `send`).
- `uiSlice` still mirrors `cluster`, `hideSmallBalances`, `theme` and carries dead reducers (`showSeedPhrase`, `hideSeedPhrase`, `showTransaction`, `hideTransaction`, `toggleHideSmallBalances`, `setSearchQuery`, `setTheme`, `setLoadingMessage`); `useWalletQueries.ts`, `TokenList.tsx`, `TransactionHistory.tsx`, `BalanceCard.tsx`, `App.tsx`, `Settings.tsx`, `AppShell.tsx` read the mirror.
- Derived state via `useEffect` + `useState`: recipient validation and selected token in `SendModal.tsx`, `hasViewed` in `SeedPhraseDisplay.tsx`, strength in `PasswordCreate.tsx`.
- Unused exports: `constants.ts` (`AUTO_LOCK_OPTIONS`, `SUPPORTED_CURRENCIES`, `DEFAULT_COMMITMENT`, `API_ENDPOINTS` parts, `NATIVE_SOL_MINT`), `encryption-simple.ts` (`encryptString`, `decryptString`, `clearMemory`, `generateSessionKey`), `wallet.ts` (`getWordList`, `isValidWord`, `getWordSuggestions` unless `SeedPhraseImport` uses them), `helius.ts` (`Transaction` event types), `coingecko.ts` leftovers. `WALLET_VERSION` is hand-copied from `package.json`; `tsconfig.json` has `resolveJsonModule: true`.
- Turning the lint rule on must be the last step so `just check` stays green after each step.

## Steps

1. Files: `src/background/router.ts`, `src/lib/protocol.ts`, `src/messaging/client.ts`
   Exhaustive switch over the full union (the `never` default is already there); remove any remaining runtime coercion; every client method returns the mapped response type with no cast; `WalletRequestPayload` for `SIGN_*` and `SEND_TRANSFER` matches what `bridge.ts` and `SendModal` send.
   Verify: `just check`.

2. Files: `src/hooks/useWalletQueries.ts`, `src/components/tokens/TokenList.tsx`, `src/components/transactions/TransactionHistory.tsx`, `src/components/wallet/BalanceCard.tsx`
   Read `cluster` and `hideSmallBalances` from `useSettings()`; query keys already carry the settings-derived values from SHIP-4.
   Verify: `just check`; `just e2e e2e/dashboard.spec.ts`.

3. Files: `src/store/slices/uiSlice.ts`, `src/popup/App.tsx`, `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`, `src/hooks/useSettings.ts`
   Delete `cluster`, `hideSmallBalances`, `theme`, `searchQuery`, `loadingMessage`, `showSeedPhraseModal`, `showTransactionDetails` and their reducers from `uiSlice`; `useUpdateSettings` and `syncSettings` stop dispatching the mirror; `App.tsx` seeds the settings query only.
   Verify: `just check`; `just e2e e2e/settings.spec.ts e2e/dashboard.spec.ts`.

4. Files: `src/components/tokens/SendModal.tsx`, `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/PasswordCreate.tsx`
   Replace derived-state effects with computed values (`useMemo` or plain expressions); keep test ids.
   Verify: `just check`; `just e2e e2e/send.spec.ts e2e/create.spec.ts`.

5. Files: `src/config/constants.ts`, `src/lib/encryption-simple.ts`, `src/lib/wallet.ts`, `src/services/coingecko.ts`, `src/services/helius.ts`
   Delete unused exports (confirm each with a repo-wide grep first); `WALLET_VERSION` becomes `import pkg from '../../package.json'` + `pkg.version`; replace `any` in `helius.ts` and `coingecko.ts` with narrow types.
   Verify: `just check`.

6. Files: `.eslintrc.cjs`, `src/content/injected.ts`
   Replace `Promise<any>` in `send` with a generic; turn `@typescript-eslint/no-explicit-any` on (`error`); fix any remaining fallout without adding disables.
   Verify: `just check` with the rule on; full `just e2e`.

## Out of scope

- Tests beyond keeping existing ones green (SHIP-8b).
- `noUncheckedIndexedAccess` or other tsconfig changes.

## Risks

- Deleting the Redux mirror in one step breaks `tsc` unless every consumer moved first; steps 2 and 3 are ordered for that.
- `import pkg from '../../package.json'` pulls the whole manifest into the bundle; it is small and contains no secrets.

## Parking lot

- Zod schemas if a dependency is ever allowed.
