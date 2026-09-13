# Docs

| Path | What it is |
|---|---|
| `adr/` | Architecture decisions: `0001` the design system, `0002` vault v2 (PBKDF2 600k + AES-GCM, versioned blob, v1 migration) |
| `legal/privacy.md` | Privacy policy. Ships in the extension as `legal/privacy.html` and is the Chrome Web Store privacy URL through GitHub Pages |
| `legal/terms.md` | Terms. Ships as `legal/terms.html` |
| `store/listing.md` | Chrome Web Store paste: listing copy, account prerequisites, privacy practices, permission justifications |
| `store/screenshots/` | Composed 1280×800 shots and promo tiles for the listing |
| `plans/` | One plan per phase, written and approved before the code; `SHIP-0-remediation-roadmap.md` is the index and the owner-action list, `SHIP-1` … `SHIP-9` the phases it ordered, `TEMPLATE.md` the shape they follow |
| `test-wallet.md` | The public BIP39 fixture used by local runs and the e2e suite |

`store/screenshots/raw/` is local working crops and is not in git.

Release notes are in `../CHANGELOG.md`; the conventions an agent works under are in `../AGENTS.md`.
