# Agent setup proposal

Survey confirmed 2026-09-08. No existing `AGENTS.md`, `justfile`, `.claude/`, `.cursor/rules/`, or CI.

## Files to create

- `justfile`
- `AGENTS.md`
- `CLAUDE.md`
- `scripts/agent-hooks/guard-shell.sh`
- `scripts/agent-hooks/protect-files.sh`
- `.claude/settings.json`
- `.cursor/hooks.json`
- `.claude/rules/extension-mv3.md`
- `.claude/rules/keyring.md`
- `.claude/rules/popup-ui.md`
- `.cursor/rules/extension-mv3.mdc`
- `.cursor/rules/keyring.mdc`
- `.cursor/rules/popup-ui.mdc`
- `.claude/skills/plan/SKILL.md`
- `.claude/skills/build/SKILL.md`
- `.claude/skills/pr/SKILL.md`
- `.claude/skills/review-pr/SKILL.md`
- `.github/pull_request_template.md`
- `.github/workflows/check.yml`
- `docs/plans/TEMPLATE.md`
- `docs/adr/0000-template.md`
- append to `.gitignore` (exists)

Skip: `format-file.sh` (no formatter). Skip MCP.

## just recipes

- `setup` → `pnpm install`
- `typecheck` → `pnpm exec tsc --noEmit`
- `lint` → `pnpm lint`
- `test` → `pnpm exec vitest run` (not `pnpm test`, which is watch)
- `check` → typecheck + lint + test
- `ext` → `pnpm build:extension`
- `branch ID SLUG` / `pr` as in the setup prompt
- omit `fmt-check`

## AGENTS.md conventions (draft)

- Chrome MV3: popup talks to the service worker; popup never holds a Keypair
- Never set `isPhantom` or write `window.phantom`
- PBKDF2 + AES-GCM via WebCrypto; do not add Argon2 WASM
- Ask before deleting anything
- Ask before `package.json` / config edits
- No commits unless the human asks
- `just check` uses `vitest run`, not watch-mode `pnpm test`
- Integer lamports / token units; no float SOL math

## Path-scoped rules

- `extension-mv3` — `src/background/**`, `src/content/**`, `manifest.json`
- `keyring` — `src/lib/**`, `src/background/**`
- `popup-ui` — `src/popup/**`, `src/components/**`

## Open questions (defaults used)

- Install `just` locally? **yes** (Homebrew)
- Add CI now? **yes** (`just check` + gitleaks)
- MCP connectors? **no**
- Git username for `just branch`? **freyja-934**
