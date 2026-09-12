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
    # Guardrails. A bare `api-key=` template is always present; a UUID after it is a real key.
    if grep -rEq 'api-key=[0-9a-f]{8}-[0-9a-f]{4}-' dist/; then
        echo "store: refusing to zip — dist/ contains a Helius key literal. Unset VITE_HELIUS_API_KEY in this shell and rebuild." >&2
        exit 1
    fi
    # The URL is assembled at runtime, so a baked key also appears as a bare UUID constant.
    # The bundle legitimately carries the nil UUID and the two RFC 4122 namespace UUIDs; nothing else.
    # -I skips binary media, whose bytes can match the pattern and print "Binary file ... matches".
    if grep -rEIoh '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' dist/ \
        | grep -vE '^(00000000-0000-0000-0000-000000000000|6ba7b81[01]-9dad-11d1-80b4-00c04fd430c8)$' \
        | grep -q .; then
        echo "store: refusing to zip — dist/ contains a UUID-shaped literal that is not a known vendor constant (a baked API key?). Unset VITE_HELIUS_API_KEY in this shell and rebuild." >&2
        exit 1
    fi
    if ! grep -q 'solana-rpc.publicnode.com' dist/manifest.json; then
        echo "store: refusing to zip — dist/manifest.json lacks the publicnode host, so the mainnet build cannot load a balance without a key." >&2
        exit 1
    fi
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
