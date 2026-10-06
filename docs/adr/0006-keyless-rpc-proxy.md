# ADR 0006 — Keyless Mainnet goes through a first-party RPC proxy

## Context

ADR 0003 left a keyless install on one host, `solana-rpc.publicnode.com`. ADR 0004
then worked around what that host will not do: it refuses `getTokenAccountsByOwner`
and serves no DAS, so token discovery went to Jupiter and compressed NFTs stayed
unlisted. Both ADRs rejected baking a Helius key into the Chrome zip, because a
key in the zip is a key anyone can unzip, and `just store` refuses to produce
that zip.

They also rejected a proxy. The reason was privacy plus operations: the calls
that need a credential are the address-keyed ones, so a proxy sees every address
a keyless install looks up, and this project did not run a backend.

That trade is what makes keyless Mainnet fragile, not a finished design.

- No free host that accepts a browser `Origin` also serves the indexed methods.
  The official mainnet host returns 403 to any request that carries one.
  publicnode accepts the origin and blocks the methods. A later public endpoint
  (NodeFlare, checked 2026-10-04) omits `getTokenAccountsByOwner` on purpose.
  Re-running `scripts/probe-mainnet-rpcs.mjs` does not produce an indexed,
  browser-safe, SLA-backed default.
- An origin-restricted key is not a fix. curl can set `Origin`.
- Jupiter is discovery only, reached after the RPC path has already failed. It
  does not provide DAS, it can change or rate-limit, and it receives the address.
- publicnode is one host with unpublished limits. The rotation in
  `src/lib/rpc-rotate.ts` is real and, on that list, has nothing to fail over to.

A production keyless install needs indexed reads and a second host, without a
key in the zip.

## Options considered

1. **Stay on publicnode and Jupiter.** Honest, and already shipped. It does not
   list compressed NFTs, and a publicnode outage is a keyless outage.
2. **Ship a second free host beside publicnode.** A data-recipient decision that
   still does not serve DAS, and the candidates that do serve
   `getTokenAccountsByOwner` throttle below this wallet's pattern (ADR 0004).
3. **Require every user to paste an RPC URL.** Correct for people who have one.
   It is not a keyless install.
4. **A first-party HTTPS proxy that holds the Helius key** (chosen). The
   extension ships the proxy URL. The key is a Worker secret.

## Decision

`workers/rpc` is a Cloudflare Worker. `PUBLIC_MAINNET_RPCS` is the proxy first,
then publicnode.

The proxy forwards a JSON-RPC POST to `https://mainnet.helius-rpc.com/` with the
key attached on the way out. It does not log the body, the address, or the
upstream URL. A log line is the HTTP status and nothing else. It allowlists the
methods this wallet already calls, rejects `getProgramAccounts` and every other
method, rejects JSON-RPC batches, caps the body at 64 KiB, and caps
`getMultipleAccounts` at 100 keys. A per-IP rate limit (30 requests in 10
seconds, one Cloudflare location) is the quota guard, because the URL will be
copied out of the extension and a client secret shipped beside it would not help.
Upstream 401 and 403 become 503, so a bad key rests the proxy and the extension
falls through to publicnode instead of treating every method as missing.

`getMultipleAccounts` is asked for 100 keys when the call lands on the proxy or
on an endpoint the user configured, and for 10 when it lands on publicnode.
publicnode's cap was measured (ADR 0004): eleven keys stall and then fail.

Request order is unchanged: a custom URL, then a Helius key the user entered,
then this list. A user who names an endpoint never hits the proxy. Devnet stays
on `https://api.devnet.solana.com`.

Jupiter is unchanged as a last resort. It runs only when every URL has refused
token enumeration. A proxy that is merely down (5xx, 429, transport) is not that
case: SOL, send, and history fall through to publicnode, and the token list says
the read failed rather than quietly asking Jupiter. When the proxy is up,
`getTokenAccountsByOwner` succeeds, DAS `getAssetsByOwner` runs on the same URL,
and Jupiter is not asked.

### Deploy

The extension constant is `https://cinder-rpc.casey-722.workers.dev`. The
Worker name in `workers/rpc/wrangler.jsonc` is `cinder-rpc`. Deploy from that
directory with Wrangler 4.36 or later (the rate-limit binding's minimum):

```bash
npx wrangler secret put HELIUS_API_KEY
npx wrangler deploy
```

The key is a Helius key used only by the Worker. It is not `VITE_HELIUS_API_KEY`,
it is not committed, and `.dev.vars` is gitignored for local runs. Deployed
2026-10-06 on the Cloudflare account whose `workers.dev` subdomain is
`casey-722`. `CINDER_MAINNET_RPC` and the matching `host_permissions` entry are
that host. Set a Helius budget alert before the monthly credit cap. The free
tier (1,000,000 credits, 10 requests per second) covers an unlisted install; the
rate limit is what keeps a copied URL from spending it.

## Consequences

- A keyless Mainnet install that can reach the proxy gets SOL, token accounts
  from the chain, DAS names, and compressed NFTs, without a key in the zip and
  without asking Jupiter.
- The proxy sees public addresses and signed transactions. That is the same
  class of data publicnode already sees, it is first-party, and the privacy
  policy names the host. Seeds, passwords, and private keys never go there.
- publicnode remains the degraded path. While the proxy is resting, balances and
  sends still work and compressed NFTs do not, which is the ADR 0003 behaviour.
- The manifest grants the proxy origin at install. `just store` still refuses a
  zip that contains a key literal.
- The proxy is an operation: a secret to rotate, a credit budget to watch, and a
  host the privacy policy has to keep naming.
