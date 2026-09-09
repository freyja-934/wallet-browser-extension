# Gate: just check (tsc + lint + vitest run).

set dotenv-load := true

install := "pnpm install"
types_c := "pnpm exec tsc --noEmit"
lint_c  := "pnpm lint"
test_c  := "pnpm exec vitest run"
ext_c   := "pnpm build:extension"

[private]
default:
    @just --list

[doc('Install dependencies')]
setup:
    {{ install }}

[doc('Everything CI runs. THE gate: agents run this before every commit.')]
check: typecheck lint test

[doc('Typecheck with tsc --noEmit')]
typecheck:
    {{ types_c }}

[doc('ESLint src')]
lint:
    {{ lint_c }}

[doc('Tests. Narrow it: just test path/to/file')]
test *ARGS:
    {{ test_c }} {{ ARGS }}

[doc('Build the loadable Chrome MV3 extension into dist/')]
ext:
    {{ ext_c }}

[doc('Serve the Wallet Standard test dApp at http://localhost:5174')]
dapp:
    pnpm exec vite --config vite.dapp.config.ts

[doc('Build dist/ then run Playwright Chromium extension click-through')]
e2e *ARGS:
    just ext
    pnpm exec playwright test {{ ARGS }}

[doc('Mainnet zip for Chrome Web Store (no Helius key, no devnet). Does not submit.')]
store:
    #!/usr/bin/env bash
    set -euo pipefail
    export VITE_NETWORK=mainnet-beta
    # Empty override beats Vite loading .env. `unset` lets Vite put the key back.
    export VITE_HELIUS_API_KEY=
    pnpm build:extension
    rm -f cinder-wallet-store.zip
    (cd dist && zip -r ../cinder-wallet-store.zip . -x '*.DS_Store')
    echo "Wrote cinder-wallet-store.zip — upload in the Chrome Web Store dashboard. See docs/store/listing.md"

[doc('New branch from a ticket: just branch KEY-123 short-slug')]
branch ID SLUG:
    git switch -c "freyja-934/{{ lowercase(ID) }}-{{ SLUG }}"

[doc('Run checks, push, open a draft PR')]
pr: check
    git push -u origin HEAD
    gh pr create --draft --web
