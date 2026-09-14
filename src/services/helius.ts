import { PublicKey, type AccountInfo, type Connection, type ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import { PUBLIC_DEVNET_RPCS, PUBLIC_MAINNET_RPCS, jupiterEnabledFor, rpcUrlsFor } from '../config/constants';
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
import { runtimeRpcUrls, runtimeSettings, runtimeSettingsOrUndefined } from '../lib/runtime-rpc';
import { METADATA_BATCH, fetchTokenMetadata, type TokenNames } from '../lib/token-metadata';
import { fetchJupiterBalances, fetchJupiterTokenInfo } from './jupiter';

const NFT_INTERFACES = new Set([
  'V1_NFT',
  'LEGACY_NFT',
  'ProgrammableNFT',
  'MplCoreAsset',
]);

const PARSE_BATCH = 5;

/**
 * Mints per `getMultipleAccounts` call. publicnode caps that method at 10 accounts,
 * measured on 2026-09-14: 11 fails, and an over-cap call stalls about three seconds
 * before erroring, so this is a number to hold to rather than discover at runtime.
 */
export const MINT_INFO_BATCH = 10;

/**
 * How many Jupiter-discovered mints one refresh will confirm on-chain. Each ten cost
 * two round trips through the single keyless mainnet host — one for the mint
 * accounts, one for the wallet's token accounts — and a hot wallet can hold
 * thousands, so this is where the popup stops asking. Whatever is left over is
 * counted into `tokensOmitted.beyondCap` and said out loud under the list, apart
 * from the holdings the chain would not confirm, because these were never asked
 * about and nothing is claimed about them.
 *
 * These are the first 200 in Jupiter's own response order, which is not a documented
 * contract and is deliberately not re-sorted here: ranking by value would need the
 * decimals of every discovered mint, which is the read this cap exists to avoid, and
 * ranking by raw integer amounts across unknown decimals compares nothing. The line
 * under the list says the cap is the first 200 Jupiter returned rather than implying
 * a judgement that was not made.
 */
export const JUPITER_MAX_TOKENS = 200;

/** What a mint account itself says: the two facts a send depends on. */
interface MintFacts {
  decimals: number;
  /** The account's owner, which *is* the token program: SPL Token or Token-2022. */
  programId: string;
}

/**
 * Holdings a refresh discovered and did not show, split by the reason, because the
 * two reasons are not the same news and the user can act on only one of them.
 * `beyondCap` is the cap this wallet chose (`JUPITER_MAX_TOKENS`) and says nothing
 * about those mints; `unconfirmed` means the chain did not back the holding up.
 */
export interface OmittedHoldings {
  /** Discovered, asked about, and not confirmed on-chain: no mint account, or no readable token account. */
  unconfirmed: number;
  /** Past `JUPITER_MAX_TOKENS`, so never asked about at all. */
  beyondCap: number;
}

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

/**
 * Decimals and token program read from the mint account, or `undefined` when this
 * account cannot be confirmed to be an initialised mint under a known token program.
 *
 * This is the load-bearing function of the keyless token list. `SendModal` feeds the
 * decimals it displays into the smallest-unit conversion, so a value taken on trust
 * from a third party would be a wrong send amount. Nothing here reads Jupiter.
 */
export function mintFactsFrom(mint: PublicKey, info: AccountInfo<Buffer> | null): MintFacts | undefined {
  if (!info) return undefined;
  const programId = info.owner.toBase58();
  if (!TOKEN_PROGRAMS.has(programId)) return undefined;
  try {
    const decoded = unpackMint(mint, info, info.owner);
    if (!decoded.isInitialized) return undefined;
    // u8 on the chain; anything else means this is not the account we think it is.
    if (!Number.isInteger(decoded.decimals) || decoded.decimals < 0 || decoded.decimals > 255) return undefined;
    return { decimals: decoded.decimals, programId };
  } catch {
    // Too short, or not a mint at all: unconfirmed, which means dropped.
    return undefined;
  }
}

/**
 * What the owner's own token account holds, or `undefined` when this account is not
 * an initialised token account of that mint belonging to that owner.
 *
 * The second half of the rule that Jupiter supplies discovery and not numbers: the
 * amount a row displays is the amount this account holds, read from the chain, and
 * never the figure Jupiter reported. The account read is the associated token
 * address, which is exactly the account `buildTransfer` spends from when a row
 * carries no `source`, so what the list shows and what a send can move are the same
 * number by construction.
 */
export function tokenAmountFrom(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
  info: AccountInfo<Buffer> | null,
): bigint | undefined {
  if (!info || !info.owner.equals(programId)) return undefined;
  try {
    const decoded = unpackAccount(account, info, programId);
    if (!decoded.isInitialized) return undefined;
    if (!decoded.mint.equals(mint) || !decoded.owner.equals(owner)) return undefined;
    return decoded.amount;
  } catch {
    // Too short, or not a token account at all: unconfirmed, which means dropped.
    return undefined;
  }
}

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
 * with 401/403: keyless mainnet has one public host, and some home-network filters
 * block publicnode outright. The UI turns this into "add an RPC endpoint" rather
 * than a generic error.
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
  /**
   * The token account this balance sits in, base58 — when it is known. The RPC
   * path enumerates accounts and always knows it; the keyless Jupiter fallback
   * returns a mint and an amount and never does, in which case the send derives
   * the associated token address instead (see `buildTransfer`).
   */
  tokenAccount?: string;
  /** Owning token program, base58: SPL Token or Token-2022. Read from the mint account's owner. */
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
  /**
   * Where the list of mints came from. `rpc` is `getTokenAccountsByOwner`, which
   * knows every account. `jupiter` is the keyless fallback, which knows only which
   * mints are held — their decimals, token programs and amounts are all read from
   * the chain afterwards, and the UI says so under the list.
   */
  tokensSource?: 'rpc' | 'jupiter';
  /**
   * Holdings discovered but not shown, split by reason (see `OmittedHoldings`).
   * Counted rather than hidden — a wallet that silently omits a real holding is
   * worse than one that says it could not read it — and split because "we did not
   * ask" and "the chain would not confirm it" are different news.
   */
  tokensOmitted?: OmittedHoldings;
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
 * Only the fields the mapper touches are named, every one `unknown`: the body
 * is untrusted HTTP, so nothing here is a promise about what arrived. The
 * transfer lists go to `normalizeHeliusTransfers`, which does its own
 * per-field checking. Anything else the endpoint returns is ignored.
 */
interface HeliusEnhancedTransaction {
  signature?: unknown;
  timestamp?: unknown;
  type?: unknown;
  err?: unknown;
  fee?: unknown;
  feePayer?: unknown;
  nativeTransfers?: unknown;
  tokenTransfers?: unknown;
}

/** One untrusted row of that response as a history row; a row that is not an object reads as an empty one. */
function heliusRowToTransaction(row: unknown): Transaction {
  const tx: HeliusEnhancedTransaction = row !== null && typeof row === 'object' ? row : {};
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

/**
 * Read `mints`' own accounts through the rotated connection and keep what they say,
 * in batches of `MINT_INFO_BATCH`. A batch no endpoint served leaves its mints out
 * of the map: unconfirmed is dropped, never inferred. A mint whose address will not
 * even parse is skipped before any call.
 */
async function confirmMints(urls: string[], mints: string[]): Promise<Map<string, MintFacts>> {
  const facts = new Map<string, MintFacts>();
  const keys: Array<{ mint: string; key: PublicKey }> = [];
  for (const mint of mints) {
    try {
      keys.push({ mint, key: new PublicKey(mint) });
    } catch {
      // Not an address; there is no account to ask about.
    }
  }

  for (let i = 0; i < keys.length; i += MINT_INFO_BATCH) {
    const batch = keys.slice(i, i + MINT_INFO_BATCH);
    let infos: Array<AccountInfo<Buffer> | null>;
    try {
      infos = await withRotatedConnection(urls, (connection) =>
        connection.getMultipleAccountsInfo(
          batch.map((entry) => entry.key),
          'confirmed',
        ),
      );
    } catch {
      continue;
    }
    batch.forEach((entry, index) => {
      const confirmed = mintFactsFrom(entry.key, infos[index] ?? null);
      if (confirmed) facts.set(entry.mint, confirmed);
    });
  }
  return facts;
}

/**
 * How much `owner` holds of each confirmed mint, read from the owner's associated
 * token account through the rotated connection, in the same batches of
 * `MINT_INFO_BATCH`.
 *
 * `confirmMints` has to have run first: the associated token address is derived
 * under the mint's *own* program, and that program is one of the two facts the mint
 * account supplies. A mint whose token account is absent, unreadable, or not this
 * owner's is left out of the map — the row is then dropped and counted, rather than
 * showing a balance the send path could not spend. A holding kept in a
 * non-canonical token account looks exactly like this, which is the known limit of
 * the keyless path and is stated in `docs/adr/0004-keyless-token-discovery.md`.
 */
async function confirmAmounts(
  urls: string[],
  owner: PublicKey,
  facts: Map<string, MintFacts>,
): Promise<Map<string, bigint>> {
  const amounts = new Map<string, bigint>();
  const keys: Array<{ mint: string; key: PublicKey; account: PublicKey; programId: PublicKey }> = [];
  for (const [mint, { programId }] of facts) {
    try {
      const key = new PublicKey(mint);
      const program = new PublicKey(programId);
      // Off-curve owners allowed: a PDA holds tokens at its associated address too.
      keys.push({ mint, key, account: getAssociatedTokenAddressSync(key, owner, true, program), programId: program });
    } catch {
      // Not an address; there is no account to ask about.
    }
  }

  for (let i = 0; i < keys.length; i += MINT_INFO_BATCH) {
    const batch = keys.slice(i, i + MINT_INFO_BATCH);
    let infos: Array<AccountInfo<Buffer> | null>;
    try {
      infos = await withRotatedConnection(urls, (connection) =>
        connection.getMultipleAccountsInfo(
          batch.map((entry) => entry.account),
          'confirmed',
        ),
      );
    } catch {
      continue;
    }
    batch.forEach((entry, index) => {
      const amount = tokenAmountFrom(entry.account, entry.key, owner, entry.programId, infos[index] ?? null);
      if (amount !== undefined) amounts.set(entry.mint, amount);
    });
  }
  return amounts;
}

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
 * Keys per Metaplex `getMultipleAccounts` call for this endpoint list.
 *
 * `METADATA_BATCH` is 100, which is the JSON-RPC limit and what a user's own
 * endpoint is asked for. The keyless Mainnet default is not a user's own endpoint:
 * publicnode caps the method at ten, the same measurement `MINT_INFO_BATCH`
 * records, so a 100-key batch there stalls three seconds and then fails — and
 * `fetchTokenMetadata` treats a failed Metaplex batch as an endpoint failure, which
 * would lose every name it had already collected. Before this the path was
 * unreachable keyless, because a keyless list was always empty; the Jupiter
 * fallback is what put names in front of it.
 */
async function metadataBatchFor(urls: string[]): Promise<number> {
  const cluster = (await runtimeSettings()).cluster;
  const publicMainnetOnly = cluster === 'mainnet-beta' && urls.length > 0 && urls.every(isPublicUrl);
  return publicMainnetOnly ? MINT_INFO_BATCH : METADATA_BATCH;
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
    // Deliberately not `runtimeSettings()`: its build-time defaults carry no
    // `rpcUrl` and no `heliusApiKey`, which is the exact shape `jupiterEnabledFor`
    // says yes to. A worker that did not answer must not be what sends a
    // configured user's address to Jupiter, so the gate below fails closed.
    const settings = await runtimeSettingsOrUndefined();

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
    let tokensSource: 'rpc' | 'jupiter' | undefined;
    let tokensOmitted: OmittedHoldings | undefined;
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
      tokensSource = 'rpc';
    } catch (error) {
      endpointsUnreachable = allUnreachable(tokenFailures, urls);
      tokensError =
        allUnavailable(tokenFailures, urls) || primaryUnavailable(tokenFailures, urls)
          ? TOKENS_UNAVAILABLE
          : describeFailures(tokenFailures, urls, error);
    }

    // No endpoint enumerates token accounts from here — the ordinary keyless mainnet
    // case. Jupiter can still say which mints are held; every number stays on-chain.
    if (tokensError === TOKENS_UNAVAILABLE && settings && jupiterEnabledFor(settings.cluster, settings)) {
      const fallback = await this.tokensFromJupiter(pubkey, urls);
      if (fallback) {
        tokens = fallback.tokens;
        tokensOmitted = fallback.omitted;
        tokensSource = 'jupiter';
        tokensError = undefined;
        endpointsUnreachable = false;
      }
    }

    // DAS names an RPC-sourced list; a Jupiter-sourced one is already named by the
    // search, and whatever it left unnamed is `getTokenNames`' on-chain job.
    if (tokens.length > 0 && tokensSource === 'rpc') {
      await this.nameFromDas(address, urls, tokens);
    }

    return {
      nativeBalance: lamports / 1e9,
      lamports: String(lamports),
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
      ...(endpointsUnreachable ? { endpointsUnreachable: true } : {}),
      ...(tokensSource !== undefined ? { tokensSource } : {}),
      ...(tokensOmitted && tokensOmitted.unconfirmed + tokensOmitted.beyondCap > 0 ? { tokensOmitted } : {}),
    };
  }

  /**
   * The keyless fallback: Jupiter says *which* mints, the chain says every number.
   *
   * Order matters, and there are two chain reads, not one. Discovery first, then
   * **`getMultipleAccounts` on the mints themselves** for `decimals` and the owning
   * token program, then **`getMultipleAccounts` on the owner's associated token
   * accounts** for the amount each one actually holds. Both are batched at
   * `MINT_INFO_BATCH` through the rotated connection, and both drop rather than
   * guess: the decimals a row displays are what `SendModal` converts the typed
   * amount with, and the balance it displays is what Max fills in and what the
   * insufficient-balance check is made against. Jupiter's own `amount` is used for
   * nothing but deciding which mints are worth asking the chain about. Names and
   * logos are asked for last, and only for the rows that survived.
   *
   * Resolves `undefined` when nothing survives, which leaves `tokensError` exactly
   * as the RPC path left it: today's behaviour, unchanged.
   */
  private async tokensFromJupiter(
    owner: PublicKey,
    urls: string[],
  ): Promise<{ tokens: TokenBalance[]; omitted: OmittedHoldings } | undefined> {
    const holdings = await fetchJupiterBalances(owner.toBase58());
    if (holdings.length === 0) return undefined;

    const considered = holdings.slice(0, JUPITER_MAX_TOKENS);
    // Never asked about, so nothing is claimed about them: a cap this wallet chose.
    const beyondCap = holdings.length - considered.length;

    const facts = await confirmMints(urls, considered.map((holding) => holding.mint));
    const amounts = await confirmAmounts(urls, owner, facts);

    const confirmed = considered.flatMap((holding) => {
      const mintFacts = facts.get(holding.mint);
      const amount = amounts.get(holding.mint);
      // A zero canonical account is a holding this wallet cannot see or spend; it
      // is counted as unconfirmed rather than shown as a balance of nothing.
      if (!mintFacts || amount === undefined || amount === 0n) return [];
      return [{ mint: holding.mint, amount: amount.toString(), ...mintFacts }];
    });
    const omitted = { unconfirmed: considered.length - confirmed.length, beyondCap };
    if (confirmed.length === 0) return undefined;

    const info = await fetchJupiterTokenInfo(confirmed.map((holding) => holding.mint));
    const tokens = confirmed.map((holding): TokenBalance => {
      const named = info.get(holding.mint);
      return {
        mint: holding.mint,
        amount: holding.amount,
        decimals: holding.decimals,
        programId: holding.programId,
        ...(named?.name !== undefined ? { name: named.name } : {}),
        ...(named?.symbol !== undefined ? { symbol: named.symbol } : {}),
        ...(named?.logoURI !== undefined ? { logoURI: named.logoURI } : {}),
      };
    });
    return { tokens, omitted };
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
      await metadataBatchFor(urls),
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
        // A 200 is not a promise of a list of rows: a body that is not an array
        // (an error object, HTML from a proxy, unparsable bytes) is no history at
        // all, so the RPC path below answers instead of this throwing or inventing rows.
        const data: unknown = await response.json().catch(() => undefined);
        if (Array.isArray(data)) return data.map(heliusRowToTransaction);
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
        nativeTransfers: activity.nativeTransfers,
        tokenTransfers: activity.tokenTransfers,
      };
    });
  }
}

// Export singleton instance
export const heliusService = new HeliusService();
