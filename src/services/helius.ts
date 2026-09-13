import { PublicKey, type Connection, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUBLIC_DEVNET_RPCS, PUBLIC_MAINNET_RPCS, rpcUrlsFor } from '../config/constants';
import { errorMessage } from '../lib/errors';
import { activityFromParsedTx, normalizeHeliusTransfers } from '../lib/parse-history';
import {
  SKIP_HTTP_STATUSES,
  SKIP_RPC_CODES,
  SKIP_RPC_MESSAGE,
  connectionErrorHttpStatus,
  isUnreachableFailure,
  rpcJson,
  withRotatedConnection,
  type RpcFailure,
} from '../lib/rpc-rotate';
import { runtimeRpcUrls, runtimeSettings } from '../lib/runtime-rpc';
import { fetchTokenMetadata, type TokenNames } from '../lib/token-metadata';

const NFT_INTERFACES = new Set([
  'V1_NFT',
  'LEGACY_NFT',
  'ProgrammableNFT',
  'MplCoreAsset',
]);

const PARSE_BATCH = 5;

/**
 * `tokensError` value meaning no configured endpoint serves the token-account
 * method from here: every URL refused the method (JSON-RPC `-32601` / `-32010` /
 * `-32011` or a message saying so) or, for a public URL, answered 401/403; or the
 * list is public URLs only and the primary refused. A 401/403 from the user's own
 * URL or a Helius key is a real failure and is reported as a message instead.
 */
export const TOKENS_UNAVAILABLE = 'unavailable';

/**
 * Thrown by `getTokenBalances`, `getNFTs`, and `getTransactionHistory` when every
 * endpoint failed at the transport layer (fetch rejected, aborted, timed out) or
 * with 401/403: some home-network filters block publicnode outright, and
 * `api.mainnet-beta` 403s any browser origin. The UI turns this into "add an RPC
 * endpoint" rather than a generic error.
 */
export class EndpointsUnreachableError extends Error {
  readonly endpointsUnreachable = true;

  constructor(readonly reason: unknown) {
    super('No RPC endpoint reachable from this network');
    this.name = 'EndpointsUnreachableError';
  }
}

export function isEndpointsUnreachable(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { endpointsUnreachable?: unknown }).endpointsUnreachable === true,
  );
}

const PUBLIC_RPC_URLS = new Set<string>([...PUBLIC_MAINNET_RPCS, ...PUBLIC_DEVNET_RPCS]);

function isPublicUrl(url: string): boolean {
  return PUBLIC_RPC_URLS.has(url);
}

/** The host only: a Helius URL carries the key in its query string. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function rpcCodeOf(error: unknown): number | undefined {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'number' && Number.isInteger(code) && code < 0 ? code : undefined;
}

/** 401/403: the door, not the method. */
function isAuthRefusal(error: unknown): boolean {
  const status = connectionErrorHttpStatus(error);
  return status !== undefined && SKIP_HTTP_STATUSES.includes(status);
}

/** The endpoint refused the method itself: a listed JSON-RPC code or the message heuristic. */
function isMethodRefusal(error: unknown): boolean {
  const code = rpcCodeOf(error);
  if (code !== undefined && SKIP_RPC_CODES.includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return SKIP_RPC_MESSAGE.test(message);
}

/**
 * Does this failure say "this endpoint does not serve the method from here"?
 * A method refusal anywhere counts; 401/403 counts only from a public host,
 * which gates token and DAS methods. From the user's own URL or a Helius key,
 * 401/403 is a real failure (a bad key, a blocked origin) worth telling them.
 */
function isUnavailableFailure(failure: RpcFailure): boolean {
  if (isAuthRefusal(failure.error)) return isPublicUrl(failure.url);
  return isMethodRefusal(failure.error);
}

/** Every URL failed, and each failure says nothing at that URL will answer us. */
function allUnreachable(failures: RpcFailure[], urls: string[]): boolean {
  return failures.length === urls.length && failures.every((failure) => isUnreachableFailure(failure.error));
}

/** Every URL failed, and each failure says the method is not served from here. */
function allUnavailable(failures: RpcFailure[], urls: string[]): boolean {
  return failures.length === urls.length && failures.every(isUnavailableFailure);
}

/** Public URLs only and the primary itself refused: nothing after it will do better. */
function primaryUnavailable(failures: RpcFailure[], urls: string[]): boolean {
  if (!urls.every(isPublicUrl)) return false;
  const primary = failures.find((failure) => failure.url === urls[0]);
  return primary !== undefined && isUnavailableFailure(primary);
}

/**
 * The failure worth reporting, in list order from the primary: the first that is
 * not a mere "not served here" refusal, since a later 503 says more than the
 * primary's `-32601`; the primary's own failure when every one is a refusal.
 */
function reportedFailure(failures: RpcFailure[], urls: string[]): RpcFailure | undefined {
  const ordered = [...failures].sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url));
  return ordered.find((failure) => !isUnavailableFailure(failure)) ?? ordered[0];
}

/** web3.js prefixes `failed to get <thing> of account <address>: `; the address is not for an error card. */
const WEB3_MESSAGE_PREFIX = /^failed to [^:]*: /;
const MESSAGE_MAX = 80;

function shortMessage(error: unknown): string {
  const text = errorMessage(error, 'request failed')
    .replace(WEB3_MESSAGE_PREFIX, '')
    .replace(/^(Type)?Error: /, '');
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text;
}

/**
 * One short line for one endpoint's failure: the host plus the HTTP status or
 * JSON-RPC code, never the raw web3.js message with the account address in it.
 */
export function describeFailure(failure: RpcFailure): string {
  const host = hostOf(failure.url);
  const status = connectionErrorHttpStatus(failure.error);
  if (status !== undefined && SKIP_HTTP_STATUSES.includes(status)) {
    return /(^|\.)helius-rpc\.com$/.test(host)
      ? `Helius rejected the API key (${status})`
      : `${host} refused (${status})`;
  }
  if (status !== undefined) return `${host} answered ${status}`;
  const code = rpcCodeOf(failure.error);
  const text = shortMessage(failure.error);
  return code !== undefined ? `${host}: ${text} (${code})` : `${host}: ${text}`;
}

/** The message for a rotated call that failed everywhere: the reported failure's line, else the thrown error's. */
function describeFailures(failures: RpcFailure[], urls: string[], thrown: unknown): string {
  const reported = reportedFailure(failures, urls);
  return reported ? describeFailure(reported) : shortMessage(thrown);
}

/**
 * Public Solana RPC has getTransaction(jsonParsed), not getParsedTransactions.
 * A signature whose details could not be fetched is `null` here, so the caller
 * can say so instead of inventing a row.
 */
async function fetchParsedTransactions(
  connection: Connection,
  signatures: string[],
): Promise<Array<ParsedTransactionWithMeta | null>> {
  const out: Array<ParsedTransactionWithMeta | null> = [];
  for (let i = 0; i < signatures.length; i += PARSE_BATCH) {
    const chunk = signatures.slice(i, i + PARSE_BATCH);
    const rows = await Promise.all(
      chunk.map((signature) =>
        connection
          .getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          })
          .catch(() => null),
      ),
    );
    out.push(...rows);
  }
  return out;
}

export interface TokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string;
  tokenAccount: string;
  /** Owning token program, base58: SPL Token or Token-2022. */
  programId: string;
}

export interface TokenBalances {
  /** SOL as a float, for the current UI. Prefer `lamports`. */
  nativeBalance: number;
  /** Exact balance in lamports, as a decimal string. */
  lamports: string;
  tokens: TokenBalance[];
  /**
   * Set when the token-account call failed on every endpoint; `tokens` is then
   * empty, not zero. `TOKENS_UNAVAILABLE` when no endpoint serves the method
   * from here, otherwise a short line naming the host and its status or code.
   */
  tokensError?: string;
  /** The token-account call found no endpoint reachable at all (see `EndpointsUnreachableError`). */
  endpointsUnreachable?: boolean;
}

export interface NFTAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      symbol: string;
      description?: string;
    };
    files?: Array<{
      uri: string;
      mime?: string;
    }>;
    links?: {
      image?: string;
      external_url?: string;
    };
  };
  compression?: {
    compressed: boolean;
    tree: string;
    leaf_id: number;
  };
  grouping?: Array<{
    group_key: string;
    group_value: string;
  }>;
  ownership: {
    owner: string;
    frozen: boolean;
  };
  royalty?: {
    basis_points: number;
    primary_sale_happened: boolean;
  };
}

export interface NFTPage {
  items: NFTAsset[];
  total: number;
  page: number;
  limit: number;
  /** No configured endpoint serves DAS from here; `items` is empty because nothing could be asked, not because the wallet is. */
  nftsUnavailable?: boolean;
}

/** One row of history, as the popup reads it. Only what the screen shows: no raw instructions, no event payloads. */
export interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed';
  fee: number;
  feePayer: string;
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: NativeTransfer[];
  /** The signature is real but its details could not be fetched: no direction, amount, or counterparty is known. */
  detailsUnavailable?: true;
}

export interface TokenTransfer {
  mint: string;
  from: string;
  to: string;
  amount: string;
  decimals: number;
}

export interface NativeTransfer {
  from: string;
  to: string;
  amount: number;
}

/**
 * One row of Helius's enhanced-transactions response, as this file reads it.
 * Only the fields the mapper touches are named, each as the widest type the
 * API could actually send; the transfer arrays are handed to
 * `normalizeHeliusTransfers`, which does its own per-field checking. Anything
 * else the endpoint returns is ignored rather than typed.
 */
interface HeliusEnhancedTransaction {
  signature?: unknown;
  timestamp?: unknown;
  type?: unknown;
  err?: unknown;
  fee?: unknown;
  feePayer?: unknown;
  nativeTransfers?: Array<Record<string, unknown>>;
  tokenTransfers?: Array<Record<string, unknown>>;
}

interface DasAssetsPage<Item> {
  items?: Item[];
  total?: number;
}

interface DasFungibleItem {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } };
  token_info?: { decimals?: number; balance?: number; symbol?: string };
}

type ParsedTokenAccounts = Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>;

/** What `getTokenNames` needs of a token: which mint, which program, and whether DAS already named it. */
export type TokenNameRef = Pick<TokenBalance, 'mint' | 'programId' | 'name' | 'symbol'>;

function tokensFrom(parsed: ParsedTokenAccounts, programId: PublicKey): TokenBalance[] {
  return parsed.value
    .map((entry) => {
      const info = entry.account.data.parsed.info;
      return {
        mint: info.mint as string,
        amount: String(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals as number,
        tokenAccount: entry.pubkey.toBase58(),
        programId: programId.toBase58(),
      };
    })
    .filter((token) => token.amount !== '0');
}

/**
 * Chain reads for the popup. Every call resolves its endpoint list from the live
 * settings (`runtimeRpcUrls`), so nothing here holds a `Connection` across calls.
 */
class HeliusService {
  private baseUrl: string = 'https://api.helius.xyz/v0';

  /**
   * SOL and token balances, with whatever names DAS gives. On-chain metadata for
   * the rest is a separate, slower read (`getTokenNames`) so neither the SOL
   * figure nor the list waits on it.
   */
  async getTokenBalances(address: string): Promise<TokenBalances> {
    const pubkey = new PublicKey(address);
    const urls = await runtimeRpcUrls();

    // Two independent rotated calls: a public endpoint that refuses
    // getTokenAccountsByOwner must never discard the SOL balance.
    const balanceFailures: RpcFailure[] = [];
    let lamports: number;
    try {
      lamports = await withRotatedConnection(
        urls,
        (connection) => connection.getBalance(pubkey),
        (failure) => balanceFailures.push(failure),
      );
    } catch (error) {
      if (allUnreachable(balanceFailures, urls)) throw new EndpointsUnreachableError(error);
      throw error;
    }

    let tokens: TokenBalance[] = [];
    let tokensError: string | undefined;
    let endpointsUnreachable = false;
    const tokenFailures: RpcFailure[] = [];
    try {
      tokens = await withRotatedConnection(
        urls,
        async (connection) => {
          const [classic, token2022] = await Promise.all([
            connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
            connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID }),
          ]);
          return [...tokensFrom(classic, TOKEN_PROGRAM_ID), ...tokensFrom(token2022, TOKEN_2022_PROGRAM_ID)];
        },
        (failure) => tokenFailures.push(failure),
      );
    } catch (error) {
      endpointsUnreachable = allUnreachable(tokenFailures, urls);
      tokensError =
        allUnavailable(tokenFailures, urls) || primaryUnavailable(tokenFailures, urls)
          ? TOKENS_UNAVAILABLE
          : describeFailures(tokenFailures, urls, error);
    }

    if (tokens.length > 0) {
      await this.nameFromDas(address, urls, tokens);
    }

    return {
      nativeBalance: lamports / 1e9,
      lamports: String(lamports),
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
      ...(endpointsUnreachable ? { endpointsUnreachable: true } : {}),
    };
  }

  /** DAS on any URL that serves it. Names are a courtesy, never an error. */
  private async nameFromDas(address: string, urls: string[], tokens: TokenBalance[]): Promise<void> {
    try {
      const das = await rpcJson<DasAssetsPage<DasFungibleItem>>(urls, 'getAssetsByOwner', {
        ownerAddress: address,
        page: 1,
        limit: 1000,
        displayOptions: { showFungible: true },
      });
      const meta = new Map((das.items ?? [])
        .filter((item) => item.interface === 'FungibleToken' || item.interface === 'FungibleAsset')
        .map((item) => [item.id, item]));
      for (const token of tokens) {
        const item = meta.get(token.mint);
        if (!item) continue;
        token.name = item.content?.metadata?.name || token.name;
        token.symbol = item.token_info?.symbol || item.content?.metadata?.symbol || token.symbol;
        token.logoURI = item.content?.links?.image || token.logoURI;
      }
    } catch {
      // No endpoint served DAS: the list stands without names, that is not an error.
    }
  }

  /**
   * Names for the tokens DAS left unnamed, from the Token-2022 metadata extension
   * and then the Metaplex metadata account, keyed by mint. A mint with neither is
   * absent, and the UI shows its short address. Throws when no endpoint answered.
   */
  async getTokenNames(tokens: TokenNameRef[]): Promise<Record<string, TokenNames>> {
    const unnamed = tokens.filter((token) => !token.symbol && !token.name);
    if (unnamed.length === 0) return {};
    const urls = await runtimeRpcUrls();
    const names = await fetchTokenMetadata(
      (fn) => withRotatedConnection(urls, fn),
      unnamed.map(({ mint, programId }) => ({ mint, programId })),
    );
    return Object.fromEntries(names);
  }

  /**
   * NFTs via DAS on any URL that serves it. Resolves `nftsUnavailable` when no
   * endpoint serves DAS from here (a configuration state, not a failure); throws
   * `EndpointsUnreachableError` when nothing answered at all; otherwise throws a
   * short line naming the endpoint that failed.
   */
  async getNFTs(address: string, page: number = 1, limit: number = 100): Promise<NFTPage> {
    const urls = await runtimeRpcUrls();
    const failures: RpcFailure[] = [];
    let das: DasAssetsPage<NFTAsset>;
    try {
      das = await rpcJson<DasAssetsPage<NFTAsset>>(
        urls,
        'getAssetsByOwner',
        {
          ownerAddress: address,
          page,
          limit,
          displayOptions: { showFungible: false },
        },
        (failure) => failures.push(failure),
      );
    } catch (error) {
      if (allUnavailable(failures, urls)) {
        return { items: [], total: 0, page, limit, nftsUnavailable: true };
      }
      if (allUnreachable(failures, urls)) throw new EndpointsUnreachableError(error);
      throw new Error(describeFailures(failures, urls, error));
    }
    const items = (das.items ?? []).filter((item) => {
      const kind = (item as NFTAsset & { interface?: string }).interface;
      return !kind || NFT_INTERFACES.has(kind);
    });
    return {
      items,
      total: das.total ?? items.length,
      page,
      limit,
    };
  }

  /**
   * History, newest first. Empty rows mean an empty history; throws
   * `EndpointsUnreachableError` when nothing answered at all, otherwise a short
   * line naming the endpoint that failed.
   */
  async getTransactionHistory(
    address: string,
    options: {
      limit?: number;
      before?: string;
      type?: string;
    } = {}
  ): Promise<Transaction[]> {
    const { limit = 100, before, type } = options;
    const settings = await runtimeSettings();
    const apiKey = settings.heliusApiKey;

    if (apiKey && settings.cluster === 'mainnet-beta') {
      let url = `${this.baseUrl}/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}`;
      if (before) url += `&before=${before}`;
      if (type) url += `&type=${type}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as HeliusEnhancedTransaction[];
        return data.map((tx) => {
          const transfers = normalizeHeliusTransfers(tx);
          return {
            signature: String(tx.signature ?? ''),
            timestamp: Number(tx.timestamp ?? 0) * 1000,
            type: String(tx.type ?? 'UNKNOWN'),
            status: tx.err ? ('failed' as const) : ('success' as const),
            fee: Number(tx.fee ?? 0),
            feePayer: String(tx.feePayer ?? ''),
            tokenTransfers: transfers.tokenTransfers,
            nativeTransfers: transfers.nativeTransfers,
          };
        });
      }
    }

    const urls = rpcUrlsFor(settings.cluster, settings);
    const failures: RpcFailure[] = [];
    let sigs: Awaited<ReturnType<Connection['getSignaturesForAddress']>>;
    let parsed: Array<ParsedTransactionWithMeta | null>;
    try {
      ({ sigs, parsed } = await withRotatedConnection(
        urls,
        async (connection) => {
          const sigs = await connection.getSignaturesForAddress(new PublicKey(address), {
            limit,
            before,
          });
          const parsed = await fetchParsedTransactions(connection, sigs.map((sig) => sig.signature));
          return { sigs, parsed };
        },
        (failure) => failures.push(failure),
      ));
    } catch (error) {
      if (allUnreachable(failures, urls)) throw new EndpointsUnreachableError(error);
      throw new Error(describeFailures(failures, urls, error));
    }
    return sigs.map((sig, index) => {
      const tx = parsed[index];
      if (!tx) {
        // The signature is real; its details are not known. Say so rather than showing a "Sent · To Unknown" row.
        return {
          signature: sig.signature,
          timestamp: (sig.blockTime ?? 0) * 1000,
          type: 'unknown',
          status: sig.err ? 'failed' : 'success',
          fee: 0,
          feePayer: address,
          instructions: [],
          events: [],
          nativeTransfers: [],
          tokenTransfers: [],
          detailsUnavailable: true,
        };
      }
      const activity = activityFromParsedTx(tx, address);
      return {
        signature: sig.signature,
        timestamp: (tx.blockTime ?? sig.blockTime ?? 0) * 1000,
        type: activity.type,
        status: tx.meta?.err || sig.err ? 'failed' : 'success',
        fee: tx.meta?.fee ?? 0,
        feePayer: address,
        instructions: [],
        events: [],
        nativeTransfers: activity.nativeTransfers,
        tokenTransfers: activity.tokenTransfers,
      };
    });
  }
}

// Export singleton instance
export const heliusService = new HeliusService();
