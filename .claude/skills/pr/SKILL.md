---
name: pr
description: Self-review the diff, run just check, push, open a draft PR from the template with evidence. Only when the human asks.
---
# /pr

1. Self-review the diff for scope creep and leftovers.
2. Run `just check` and paste evidence.
3. Push the current branch. Do not push `main`.
4. Open a **draft** PR from `.github/pull_request_template.md`.
5. Only run this skill when the human asked for a PR.
