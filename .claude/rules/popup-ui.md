---
paths:
  - "src/popup/**"
  - "src/components/**"
---
- Route on `hasVault`: no vault → create; vault + locked → unlock.
- Do not invent portfolio deltas or “available” percentages.
- Chain data (balances, NFTs, history) goes through React Query, not new Redux thunks.
- Redux holds lock state, public accounts, active account, and modal flags only.
- The popup never imports or holds a `Keypair`.
