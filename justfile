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

[doc('Build the loadable Chrome MV3 extension into dist/ (CINDER_OUT_DIR overrides)')]
ext:
    #!/usr/bin/env bash
    set -euo pipefail
    OUT="${CINDER_OUT_DIR:-dist}"
    {{ ext_c }}
    # The provider runs in the page's MAIN world: it must carry no API key, no build-time env, and no chrome.* call.
    for needle in 'api-key' 'VITE_' 'chrome.'; do
        if grep -qF -- "$needle" "$OUT/src/content/injected.js"; then
            echo "ext: refusing $OUT/ — $OUT/src/content/injected.js contains '$needle'; the page-world bundle must not." >&2
            exit 1
        fi
    done

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
    # Its own output directory: dist/ stays the devnet build that is loaded unpacked.
    export CINDER_OUT_DIR=dist-store
    OUT="$CINDER_OUT_DIR"
    rm -rf "$OUT"
    # Remember any key the shell or .env (dotenv-load) carried, so the bundle can be checked for it below.
    KEY_FROM_ENV="${VITE_HELIUS_API_KEY:-}"
    # Empty override beats Vite loading .env. `unset` lets Vite put the key back.
    export VITE_HELIUS_API_KEY=
    just ext
    # Guardrails. The URL is assembled at runtime, so a baked key appears as a bare UUID constant.
    # The bundle legitimately carries the nil UUID and the two RFC 4122 namespace UUIDs; nothing else.
    # -I skips binary media, whose bytes can match the pattern and print "Binary file ... matches".
    if grep -rEIoh '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$OUT/" \
        | grep -vE '^(00000000-0000-0000-0000-000000000000|6ba7b81[01]-9dad-11d1-80b4-00c04fd430c8)$' \
        | grep -q .; then
        echo "store: refusing to zip — $OUT/ contains a UUID-shaped literal that is not a known vendor constant (a baked API key?). Unset VITE_HELIUS_API_KEY in this shell and rebuild." >&2
        exit 1
    fi
    # Whatever key the environment carried, in any shape, must not be in the bundle.
    if [ -n "$KEY_FROM_ENV" ] && grep -rqF -- "$KEY_FROM_ENV" "$OUT/"; then
        echo "store: refusing to zip — $OUT/ contains the VITE_HELIUS_API_KEY from this shell or .env; the empty override did not take. Unset it and rebuild." >&2
        exit 1
    fi
    if ! grep -q 'solana-rpc.publicnode.com' "$OUT/manifest.json"; then
        echo "store: refusing to zip — $OUT/manifest.json lacks the publicnode host, so the mainnet build cannot load a balance without a key." >&2
        exit 1
    fi
    rm -f cinder-wallet-store.zip
    (cd "$OUT" && zip -r ../cinder-wallet-store.zip . -x '*.DS_Store')
    echo "Wrote cinder-wallet-store.zip — upload in the Chrome Web Store dashboard. See docs/store/listing.md"

[doc('New branch from a ticket: just branch KEY-123 short-slug')]
branch ID SLUG:
    git switch -c "freyja-934/{{ lowercase(ID) }}-{{ SLUG }}"

[doc('Run checks, push, open a draft PR')]
pr: check
    git push -u origin HEAD
    gh pr create --draft --web
