import {
  JUPITER_BALANCES_URL,
  JUPITER_SEARCH_BATCH,
  JUPITER_TOKEN_SEARCH_URL,
} from '../config/constants';
import { cleanText, fetchGuardedJson, httpsUrl } from '../lib/untrusted-http';

/**
 * Jupiter's free public API, read keylessly. **Discovery and cosmetics only.**
 *
 * What this file is allowed to produce: which mints an address holds, and what
 * those mints are called. What it must never produce: a number the user acts on.
 * `decimals` in particular is read from the mint account on-chain by the caller,
 * never from a response here — `SendModal` feeds the displayed decimals into the
 * smallest-unit conversion, so a wrong value there is a wrong send amount. The
 * `uiAmount` field Jupiter returns alongside each balance is a float and is
 * deliberately ignored; only the integer `amount` string is read.
 *
 * Both bodies are untrusted HTTP, treated exactly as `HeliusEnhancedTransaction`
 * is treated in `helius.ts`: every field is `unknown` until it is checked, and
 * anything unrecognised is ignored rather than passed along. Neither exported
 * function throws: a refusal, a timeout, a truncated body or a hostile one all
 * degrade to "nothing found", which is the state the wallet was already in.
 */

/** Per request. Jupiter answered the whale case in well under a second; this is the give-up point. */
export const JUPITER_TIMEOUT_MS = 8_000;

/**
 * Give-up size for one response body. The measured worst case is a hot wallet
 * holding thousands of mints, about 460 KB on 2026-09-14, and the plan budgets
 * 528 KB; 2 MB is several times that and still far from a body that could stall
 * the popup. Enforced against the bytes as they arrive (see `textWithinGuard`),
 * so an undeclared or chunked body is cut off mid-transfer rather than
 * materialised and then rejected.
 */
export const JUPITER_MAX_RESPONSE = 2_000_000;

/** Base58, 32 bytes: the shape of every Solana mint address. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** An integer smallest-unit amount as a decimal string; a u64 is at most 20 digits. */
const INTEGER_AMOUNT = /^[0-9]{1,20}$/;

const U64_MAX = 18_446_744_073_709_551_615n;

/** One holding as this wallet reads it: a mint, and an integer amount in smallest units. */
export interface JupiterHolding {
  mint: string;
  /** Integer smallest units, decimal string. Not scaled by anything: decimals are not known here. */
  amount: string;
}

/** Cosmetics for one mint. Every field optional: a mint Jupiter does not know is shown by its address. */
export interface JupiterTokenInfo {
  mint: string;
  name?: string;
  symbol?: string;
  logoURI?: string;
}

/**
 * A logo URL safe to hand an `<img src>`. The rule is not Jupiter's — it is the
 * one every untrusted URL in this wallet goes through (see `httpsUrl`) — and this
 * name is kept because the token row is what asks for it.
 */
export const logoUrl = httpsUrl;

/** One GET of one Jupiter document, under this file's own time and size limits. */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  return fetchGuardedJson(url, { timeoutMs: JUPITER_TIMEOUT_MS, maxBytes: JUPITER_MAX_RESPONSE, signal });
}

/**
 * Which mints this address holds, according to Jupiter.
 *
 * The body is an object keyed by mint, plus a `SOL` key for the native balance
 * that this wallet already reads from the chain and so ignores here. Each value
 * carries an integer `amount` string and a float `uiAmount`; only the first is
 * read. A key that is not a base58 address, an amount that is not an integer or
 * does not fit a u64, and a zero balance are all skipped — as is the whole call
 * when anything at all goes wrong.
 */
export async function fetchJupiterBalances(address: string, signal?: AbortSignal): Promise<JupiterHolding[]> {
  if (!BASE58_ADDRESS.test(address)) return [];
  const body = await getJson(`${JUPITER_BALANCES_URL}/${address}`, signal);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];

  const holdings: JupiterHolding[] = [];
  for (const [mint, raw] of Object.entries(body as Record<string, unknown>)) {
    // `SOL` is the native balance under a name that is not a mint; both tests fail it anyway.
    if (!BASE58_ADDRESS.test(mint)) continue;
    if (raw === null || typeof raw !== 'object') continue;
    const amount = (raw as { amount?: unknown }).amount;
    if (typeof amount !== 'string' || !INTEGER_AMOUNT.test(amount)) continue;
    let value: bigint;
    try {
      value = BigInt(amount);
    } catch {
      continue;
    }
    if (value <= 0n || value > U64_MAX) continue;
    holdings.push({ mint, amount: value.toString() });
  }
  return holdings;
}

/** `tokens/v2/search` for one batch of mints; an unusable body is an empty batch. */
async function searchBatch(mints: string[], signal?: AbortSignal): Promise<JupiterTokenInfo[]> {
  const query = encodeURIComponent(mints.join(','));
  const body = await getJson(`${JUPITER_TOKEN_SEARCH_URL}?query=${query}`, signal);
  if (!Array.isArray(body)) return [];

  const wanted = new Set(mints);
  const rows: JupiterTokenInfo[] = [];
  for (const raw of body as unknown[]) {
    if (raw === null || typeof raw !== 'object') continue;
    const row = raw as { id?: unknown; name?: unknown; symbol?: unknown; icon?: unknown };
    const mint = typeof row.id === 'string' ? row.id : undefined;
    // A row for a mint nobody asked about is not this wallet's business.
    if (!mint || !wanted.has(mint)) continue;
    const name = cleanText(row.name);
    const symbol = cleanText(row.symbol);
    const logo = logoUrl(row.icon);
    // `decimals`, `tokenProgram`, `usdPrice` and the rest of the row are ignored on purpose:
    // every one of those is read from the chain, or not used at all.
    rows.push({
      mint,
      ...(name !== undefined ? { name } : {}),
      ...(symbol !== undefined ? { symbol } : {}),
      ...(logo !== undefined ? { logoURI: logo } : {}),
    });
  }
  return rows;
}

/**
 * Names, symbols and logos for `mints`, keyed by mint. Batched at the endpoint's
 * documented 100-mint cap, one batch at a time so a large wallet does not open a
 * dozen sockets at once. A mint the search does not return is simply absent, and
 * `src/lib/token-metadata.ts` remains the on-chain fallback for those.
 */
export async function fetchJupiterTokenInfo(
  mints: string[],
  signal?: AbortSignal,
): Promise<Map<string, JupiterTokenInfo>> {
  const unique = [...new Set(mints.filter((mint) => BASE58_ADDRESS.test(mint)))];
  const found = new Map<string, JupiterTokenInfo>();
  for (let i = 0; i < unique.length; i += JUPITER_SEARCH_BATCH) {
    if (signal?.aborted) break;
    for (const row of await searchBatch(unique.slice(i, i + JUPITER_SEARCH_BATCH), signal)) {
      if (!found.has(row.mint)) found.set(row.mint, row);
    }
  }
  return found;
}
