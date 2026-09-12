import { PublicKey, type Connection, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUBLIC_DEVNET_RPCS, PUBLIC_MAINNET_RPCS, rpcUrlsFor } from '../config/constants';
import { errorMessage } from '../lib/errors';
import { activityFromParsedTx, normalizeHeliusTransfers } from '../lib/parse-history';
import { isUnreachableFailure, rpcJson, withRotatedConnection, type RpcFailure } from '../lib/rpc-rotate';
import { runtimeRpcUrls, runtimeSettings } from '../lib/runtime-rpc';
import { fetchTokenMetadata } from '../lib/token-metadata';

const NFT_INTERFACES = new Set([
  'V1_NFT',
  'LEGACY_NFT',
  'ProgrammableNFT',
  'MplCoreAsset',
]);

const PARSE_BATCH = 5;

/**
 * `tokensError` value meaning no configured endpoint serves the token-account
 * method from here (auth or method refusals everywhere, or only public URLs and
 * the primary refused). Anything else in `tokensError` is a real failure message.
 */
export const TOKENS_UNAVAILABLE = 'unavailable';

/**
 * Thrown by `getTokenBalances` when every endpoint failed at the transport layer
 * (fetch rejected, aborted, timed out) or with 401/403: some home-network filters
 * block publicnode outright, and `api.mainnet-beta` 403s any browser origin.
 * The UI turns this into "add an RPC endpoint" rather than a generic error.
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

/** Every URL failed, and each failure says nothing at that URL will answer us. */
function allUnreachable(failures: RpcFailure[], urls: string[]): boolean {
  return failures.length === urls.length && failures.every((failure) => isUnreachableFailure(failure.error));
}

/** Every URL answered "not for you" (auth, missing method). */
function allSkipped(failures: RpcFailure[], urls: string[]): boolean {
  return failures.length === urls.length && failures.every((failure) => failure.verdict === 'skip');
}

/** Public Solana RPC has getTransaction(jsonParsed), not getParsedTransactions. */
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
   * from here, otherwise the failure message.
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

export interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed';
  fee: number;
  feePayer: string;
  instructions: any[];
  events: TransactionEvent[];
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: NativeTransfer[];
}

export interface TransactionEvent {
  type: string;
  data: any;
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
      const publicOnly = urls.every((url) => PUBLIC_RPC_URLS.has(url));
      const primaryRefused = tokenFailures.find((failure) => failure.url === urls[0])?.verdict === 'skip';
      tokensError =
        allSkipped(tokenFailures, urls) || (publicOnly && primaryRefused)
          ? TOKENS_UNAVAILABLE
          : errorMessage(error, 'Token accounts unavailable');
    }

    if (tokens.length > 0) {
      await this.nameTokens(address, urls, tokens);
    }

    return {
      nativeBalance: lamports / 1e9,
      lamports: String(lamports),
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
      ...(endpointsUnreachable ? { endpointsUnreachable: true } : {}),
    };
  }

  /** DAS on any URL that serves it, then on-chain metadata for whatever is still unnamed. Names are a courtesy, never an error. */
  private async nameTokens(address: string, urls: string[], tokens: TokenBalance[]): Promise<void> {
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

    const unnamed = tokens.filter((token) => !token.symbol && !token.name);
    if (unnamed.length === 0) return;
    try {
      const names = await fetchTokenMetadata(
        (fn) => withRotatedConnection(urls, fn),
        unnamed.map((token) => ({ mint: token.mint, programId: token.programId })),
      );
      for (const token of unnamed) {
        const found = names.get(token.mint);
        if (!found) continue;
        if (found.name) token.name = found.name;
        if (found.symbol) token.symbol = found.symbol;
      }
    } catch {
      // Same: a mint without a name shows as its short mint in the UI.
    }
  }

  /**
   * NFTs via DAS on any URL that serves it. Throws when the call failed; resolves
   * `nftsUnavailable` when no endpoint serves DAS at all, which is a configuration
   * state, not a failure.
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
      if (allSkipped(failures, urls)) {
        return { items: [], total: 0, page, limit, nftsUnavailable: true };
      }
      throw error;
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

  /** History, newest first; throws when no endpoint could answer. Empty rows mean an empty history. */
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
        const data = await response.json();
        return data.map((tx: any) => {
          const transfers = normalizeHeliusTransfers(tx);
          return {
            signature: tx.signature,
            timestamp: tx.timestamp * 1000,
            type: tx.type,
            status: tx.err ? 'failed' : 'success',
            fee: tx.fee,
            feePayer: tx.feePayer,
            instructions: tx.instructions,
            events: tx.events || [],
            tokenTransfers: transfers.tokenTransfers,
            nativeTransfers: transfers.nativeTransfers,
          };
        });
      }
    }

    const urls = rpcUrlsFor(settings.cluster, settings);
    const { sigs, parsed } = await withRotatedConnection(urls, async (connection) => {
      const sigs = await connection.getSignaturesForAddress(new PublicKey(address), {
        limit,
        before,
      });
      const parsed = await fetchParsedTransactions(connection, sigs.map((sig) => sig.signature));
      return { sigs, parsed };
    });
    return sigs.map((sig, index) => {
      const tx = parsed[index];
      if (!tx) {
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
