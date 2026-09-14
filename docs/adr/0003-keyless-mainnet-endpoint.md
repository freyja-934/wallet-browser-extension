# ADR 0003 — One keyless Mainnet endpoint: publicnode

## Context

Cinder ships with no API key. A key inside a Chrome Web Store zip is a key anyone
can unzip, so the endpoint list has to come from Settings and from a default that
costs nothing to publish. That leaves the question of which free public Solana
Mainnet host a keyless install talks to.

The obvious answer does not work. `https://api.mainnet-beta.solana.com` answers
403 to any request carrying an `Origin` header, and every request from an
extension carries one, so it could not serve a single call from here.

The rest of the free field has to be judged from a browser, not from a terminal.
curl does not enforce CORS, so it reports an endpoint as working when a browser
would refuse it. `solana.leorpc.com` is the worked example: its preflight answers
200 with `access-control-allow-origin: *` and no `access-control-allow-headers`
at all, which reads as healthy under curl.

## Options considered

1. **Ship `api.mainnet-beta.solana.com` anyway.** Zero work, and every keyless
   Mainnet read fails with a 403 the user cannot act on.
2. **Bake a Helius key into the build.** Full features on day one, and the key is
   extractable from the zip by anyone who installs the extension. `just store`
   exists specifically to refuse this.
3. **List several free hosts for redundancy.** Attractive until each candidate is
   probed from a real extension origin; see the survey below.
4. **One default host — publicnode — plus a user-supplied RPC URL or Helius key
   in Settings** (chosen).

## Decision

`PUBLIC_MAINNET_RPCS` holds exactly one entry,
`https://solana-rpc.publicnode.com`. `api.mainnet-beta.solana.com` is in neither
the endpoint list nor the manifest, because a host permission that can never be
spent is a permission a reviewer has to read for nothing.

The field was swept on 2026-09-13 with `node scripts/probe-mainnet-rpcs.mjs`,
which fetches a balance from a real `chrome-extension://` page for exactly the
CORS reason above:

| Candidate | From an extension origin |
|---|---|
| `solana-rpc.publicnode.com` | serves the origin (verified 2026-09-14 from an unfiltered network) — **shipped** |
| `api.mainnet-beta.solana.com` | 403 to any request with an `Origin` header |
| `solana.api.onfinality.io/public` | 429 without a key |
| `solana.drpc.org` | 400, "not available on free plan" |
| `endpoints.omniatech.io/v1/sol/mainnet/public` | 521 |
| `solana.leorpc.com/?api_key=FREE` | serves the origin — deliberately **not** shipped |

Ankr and BlockEden are not in the table and not in the script's candidate list:
both demand a key before a request is accepted, so they were excluded on their
signup terms rather than measured from an extension origin.

leorpc is the interesting one. It works, and it is left out on purpose: every
host in this list receives the addresses a user looks up and the transactions
they sign, so a shared free-tier credential on a small provider is a trust
decision rather than a redundancy win, and it would need saying in the privacy
policy.

publicnode is verified, not assumed. On 2026-09-14
`E2E_LIVE_MAINNET=1 just e2e e2e/rpc.spec.ts` passed from a `chrome-extension://`
origin, and the shipping `just store` build read a real Mainnet balance through
it with no key set. Earlier probes from the author's connection all failed at the
TLS handshake — an ISP filter rather than the host, since
`https://api.devnet.solana.com` answered 200 over the same network. That filter
is why the live check is opt-in behind `E2E_LIVE_MAINNET` instead of part of the
suite.

## Consequences

- **Keyless Mainnet is SOL-only** for tokens and NFTs. publicnode is documented
  as serving no DAS and refusing `getTokenAccountsByOwner`, which is what the
  wallet is built to expect. Devnet's public host serves both, so Devnet is the
  full-feature demo.
- publicnode is goodwill, provided AS IS with unpublished limits. When it is
  blocked or down there is no keyless Mainnet endpoint at all, and the popup says
  exactly that and asks for an endpoint in Settings rather than rendering a zero
  it does not know. The fix offered to the user is a custom RPC URL or a Helius
  key, both stored on the device.
- The manifest grants `https://solana-rpc.publicnode.com/*` and not
  `api.mainnet-beta.solana.com`; `e2e/rpc.spec.ts` asserts both, so the decision
  fails a test if someone reverses it by hand.
- Revisiting this means re-running `node scripts/probe-mainnet-rpcs.mjs` first.
  The field changes: a host that 429s today may be fine next quarter, and a host
  that serves this origin today may start demanding a key without notice.
