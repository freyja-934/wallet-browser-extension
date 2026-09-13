# Store screenshots

Generated, not hand-made. `raw/` is gitignored; the composed `*-1280x800.png`
and the two promo tiles are committed and are what gets uploaded.

```bash
# 1. Build the extension for the cluster you want in the shot.
VITE_HELIUS_API_KEY= VITE_NETWORK=mainnet-beta CINDER_OUT_DIR=dist-shots pnpm build:extension
# 2. The approval shots need the test dApp up.
just dapp
# 3. Capture, then compose.
CINDER_OUT_DIR=dist-shots node scripts/capture-screenshots.mjs
node scripts/compose-store-images.mjs
```

Each capture step is independent: a screen the machine cannot load is reported
as `SKIPPED` and leaves the previous file alone, so a partial run never half
overwrites the set.

## Provenance

The set is assembled from two runs, because no single cluster can show every
claim. Each caption has to be true of the picture beside it.

| Image | Cluster | Why |
|---|---|---|
| `01-home` | mainnet | The caption promises live prices, so it needs a real balance and a real quote. |
| `02-approve` | devnet | Simulation must succeed. The mainnet fixture cannot pay a fee (see below). |
| `03-connect` | devnet | Same approval run. |
| `04-send` | mainnet | The caption promises a network-quoted fee. |
| `05-tokens` | devnet | The mainnet fixture holds no SPL tokens; the devnet one holds both named and unnamed mints. |
| `extra-activity` | mainnet | Real dated history. |
| `extra-receive` | mainnet | Cluster-independent. |
| `extra-settings` | mainnet, keyless build | Must show the fields a store install actually starts with: empty custom RPC, empty Helius key. |

## Two things to keep honest

**Never compose without looking.** Every composed image must be opened and read
against its own caption before it is committed. A shot captured from the wrong
cluster looks fine in a file listing and wrong in the store.

**Capture from a store-equivalent build.** Export `VITE_HELIUS_API_KEY=` so the
build matches what `just store` ships. Otherwise the settings screen shows a
populated key field that no store user will ever see. Everything in the current
set was verified to render identically without a key, with one exception: the
mainnet screens were captured on a machine whose network cannot reach
`solana-rpc.publicnode.com`, so those three needed a key to read the chain at
all. The rendered values are chain facts and are endpoint-independent, but
`extra-settings` is the one that had to come from the keyless build.
