---
name: review-pr
description: Review a diff for AI-written code — scope, correctness, security, tests that would fail, hallucinated APIs. Output blockers, should-fix, then at most five nits.
---
# /review-pr

Checklist tuned for this wallet:

- Scope: only the requested files
- Correctness: mnemonic → `mnemonicToSeed`, integer amounts, Wallet Standard return types
- Security: no Phantom impersonation, no password storage, origin-bound approvals, no secret logs
- Tests that would actually fail if the change broke
- Hallucinated packages or Chrome APIs

Output: blockers, then should-fix, then at most five nits.
