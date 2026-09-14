import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { cleanText, fetchGuardedJson, httpsUrl } from '../lib/untrusted-http';
import {
  METADATA_BATCH,
  METADATA_PROGRAM_ID,
  decodeMetadata,
  metadataPda,
  type ConnectionRunner,
} from '../lib/token-metadata';

/**
 * Naming and picturing the one-of-ones the keyless path found (see
 * `MintFacts.isOneOfOne` in `helius.ts`), in two reads that are deliberately
 * kept apart.
 *
 * **On-chain**, and cheap: the Metaplex metadata account of each mint, read
 * through the same rotated connection everything else uses, gives a name, a
 * symbol and a URI. **Off-chain**, and hostile: that URI points at a document on
 * a host the NFT's creator chose, which is where the picture is named. No
 * allowlist can anticipate those hosts, so the document is read under the same
 * rules `jupiter.ts` reads a third party's balances under — https only, no
 * cookie, a timeout, a size guard enforced on the bytes as they arrive, and
 * every field checked before it is believed (see `src/lib/untrusted-http.ts`).
 *
 * Nothing in this file runs for the token list, and nothing in it runs while the
 * user is on the home tab. It is the collectibles tab asking, item by item and
 * page by page.
 *
 * Neither exported fetch throws. An item whose metadata account is missing,
 * truncated, or not a metadata account at all comes back as its bare mint and is
 * still shown: the wallet holds it either way, and hiding it would be the one
 * answer that is certainly wrong.
 */

/** Items per page the gallery asks for: two of publicnode's ten-account calls. */
export const COLLECTIBLES_PAGE = 20;

/** Per off-chain metadata request. A creator's host is not Jupiter; this is the give-up point. */
export const COLLECTIBLE_TIMEOUT_MS = 8_000;

/**
 * Give-up size for one metadata document. The Metaplex standard document is a
 * name, a symbol, a description, a handful of URLs and a trait list — the real
 * Frog #8699 document is 921 bytes. 200 KB is two hundred times that and still
 * nothing a popup notices; anything larger is not a metadata document.
 */
export const COLLECTIBLE_MAX_RESPONSE = 200_000;

/** One collectible as the wallet reads it. Only `mint` is ever certain. */
export interface Collectible {
  /** The mint, base58. Always present: an item whose metadata could not be read is still held. */
  mint: string;
  /** From the metadata account, cleaned of control characters and bidirectional overrides. */
  name?: string;
  symbol?: string;
  /**
   * The off-chain metadata document, https only (`ipfs://` rewritten to a
   * gateway). Absent when the account named something this wallet will not
   * fetch, which simply means no picture.
   */
  uri?: string;
}

/**
 * One metadata account as one collectible. An account that is absent, owned by
 * something other than the Metaplex program, or too short to decode yields the
 * bare mint rather than nothing: the item is held and must still appear.
 */
export function collectibleFrom(mint: string, account: AccountInfo<Buffer> | null): Collectible {
  if (!account || !account.owner.equals(METADATA_PROGRAM_ID)) return { mint };
  const decoded = decodeMetadata(account.data);
  if (!decoded) return { mint };
  const name = cleanText(decoded.name);
  const symbol = cleanText(decoded.symbol);
  const uri = httpsUrl(decoded.uri);
  return {
    mint,
    ...(name !== undefined ? { name } : {}),
    ...(symbol !== undefined ? { symbol } : {}),
    ...(uri !== undefined ? { uri } : {}),
  };
}

/**
 * Names, symbols and URIs for `mints`, in `mints`' own order, one batch of
 * `batchSize` keys per call and one call at a time. The caller pages the list
 * (`COLLECTIBLES_PAGE`), so a collector holding hundreds does not turn a tab
 * switch into dozens of simultaneous requests against an endpoint that caps
 * `getMultipleAccounts` at ten.
 *
 * A batch no endpoint would serve yields its mints unnamed rather than losing
 * them, and never throws: a failed picture is not a failed wallet.
 */
export async function fetchCollectibles(
  run: ConnectionRunner,
  mints: string[],
  batchSize: number = METADATA_BATCH,
): Promise<Collectible[]> {
  const keys: Array<{ mint: string; key: PublicKey }> = [];
  for (const mint of mints) {
    try {
      keys.push({ mint, key: new PublicKey(mint) });
    } catch {
      // Not an address; there is no account to ask about, and nothing to show.
    }
  }

  const perCall = Math.max(1, Math.min(batchSize, METADATA_BATCH));
  const out: Collectible[] = [];
  for (let i = 0; i < keys.length; i += perCall) {
    const batch = keys.slice(i, i + perCall);
    let accounts: Array<AccountInfo<Buffer> | null>;
    try {
      accounts = await run((connection) => connection.getMultipleAccountsInfo(batch.map(({ key }) => metadataPda(key))));
    } catch {
      out.push(...batch.map(({ mint }) => ({ mint })));
      continue;
    }
    batch.forEach(({ mint }, index) => out.push(collectibleFrom(mint, accounts[index] ?? null)));
  }
  return out;
}

/**
 * The picture named by a Metaplex metadata document, or `undefined`.
 *
 * `image` is where the standard puts it; `properties.files[]` is where a good
 * many collections put it instead, so the first usable entry there is the
 * fallback. Every candidate goes through `httpsUrl`, which is what refuses a
 * `data:`, `javascript:` or plain-http URL and what rewrites `ipfs://` — a
 * document is a stranger's JSON, and the only thing taken out of it is one
 * string that survived that test.
 */
export function imageFromMetadata(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const row = body as { image?: unknown; properties?: unknown };
  const direct = httpsUrl(row.image);
  if (direct !== undefined) return direct;

  const properties = row.properties;
  if (properties === null || typeof properties !== 'object') return undefined;
  const files = (properties as { files?: unknown }).files;
  if (!Array.isArray(files)) return undefined;
  for (const file of files as unknown[]) {
    if (file === null || typeof file !== 'object') continue;
    const uri = httpsUrl((file as { uri?: unknown }).uri);
    if (uri !== undefined) return uri;
  }
  return undefined;
}

/**
 * Fetch one collectible's off-chain document and take the image URL out of it.
 * Resolves `undefined` for every way this can go wrong — a URI this wallet will
 * not fetch, a refusal, a timeout, an oversized or truncated body, a body that
 * is not JSON, a document with no usable picture in it — and throws for none of
 * them. The card then shows its placeholder, which is the honest answer.
 */
export async function fetchCollectibleImage(uri: string, signal?: AbortSignal): Promise<string | undefined> {
  const url = httpsUrl(uri);
  if (url === undefined) return undefined;
  const body = await fetchGuardedJson(url, {
    timeoutMs: COLLECTIBLE_TIMEOUT_MS,
    maxBytes: COLLECTIBLE_MAX_RESPONSE,
    signal,
  });
  return imageFromMetadata(body);
}
