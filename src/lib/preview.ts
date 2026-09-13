import {
  ComputeBudgetProgram,
  PublicKey,
  type AccountInfo,
  type AddressLookupTableAccount,
  type VersionedTransaction,
} from '@solana/web3.js';
import { balanceDiff, touchedMints, type PostAccount } from './balance-diff';
import {
  collectWarnings,
  decodeInstruction,
  deserializeTransaction,
  getInstructions,
  lookupTableKeys,
  requiredSigners,
  resolveAccountKeys,
  type DecodedInstruction,
  type PreviewWarning,
} from './tx-preview';

/** One account as `simulateTransaction` returns it with `accounts.encoding: 'base64'`. */
export interface SimulatedAccount {
  owner: string;
  lamports: number;
  /** `[base64, 'base64']` */
  data: string[];
}

export interface SimulationValue {
  err: unknown;
  logs?: string[] | null;
  unitsConsumed?: number;
  /** One entry per requested address, in order; `null` for an account that does not exist afterwards. */
  accounts?: Array<SimulatedAccount | null> | null;
}

/**
 * What the preview needs from the network, injected so the pipeline is a pure
 * function of bytes and answers. Each may throw; a failure leaves the decoded
 * instructions in place and reports the message.
 */
export interface PreviewDeps {
  /** The active account: the signer check and the owner whose balances the diff reports. */
  owner: PublicKey;
  fetchLookupTables(keys: PublicKey[]): Promise<AddressLookupTableAccount[]>;
  fetchAccounts(keys: PublicKey[]): Promise<Map<string, AccountInfo<Buffer> | null>>;
  fetchMintDecimals(mints: PublicKey[]): Promise<Map<string, number>>;
  /** Simulate with `{ sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true, accounts: { encoding: 'base64', addresses } }`. */
  simulate(tx: VersionedTransaction, addresses: string[]): Promise<SimulationValue>;
}

/** JSON-safe: the preview crosses `chrome.runtime.sendMessage`, which cannot carry a bigint. */
export interface PreviewTokenDelta {
  mint: string;
  /** Base units as decimal strings. */
  pre: string;
  post: string;
  /** `null` when the mint could not be read; the amounts are then base units. */
  decimals: number | null;
  programId: string;
}

export interface PreviewDiff {
  /** Lamports as decimal strings. */
  sol: { pre: string; post: string };
  tokens: PreviewTokenDelta[];
  /** The fee the message will pay if it lands, in lamports: base fee per signature plus any compute-budget priority fee. */
  fee: string;
  /** True when the transaction writes more accounts than one simulation can report, so some changes may be missing. */
  partial: boolean;
}

export interface PreviewResult {
  /** True only when the simulation ran and reported no error. */
  success: boolean;
  /** Decode error, RPC error, the signer check, or the simulation's own error. */
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
  instructions: DecodedInstruction[];
  warnings: PreviewWarning[];
  /** Present when the simulation succeeded and returned account state. */
  diff?: PreviewDiff;
  /** The active account is one of the signers the message requires. */
  signerOk: boolean;
  /** Some instruction could not be decoded: a lookup table the preview could not read, or malformed bytes. */
  unreadable: boolean;
}

export const UNREADABLE_TRANSACTION_WARNING: PreviewWarning = {
  level: 'danger',
  message: 'Unreadable transaction. Reject unless you trust this site.',
};

export const NOT_A_SIGNER_ERROR = 'This transaction does not require a signature from your account';

/** The RPC caps `simulateTransaction` `accounts.addresses`; the diff is marked partial past this. */
export const MAX_SIMULATED_ACCOUNTS = 32;

const LAMPORTS_PER_SIGNATURE = 5_000n;
const DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION = 200_000n;
const MAX_COMPUTE_UNITS = 1_400_000n;

/**
 * The fee the runtime charges when the message lands: `LAMPORTS_PER_SIGNATURE`
 * per required signature, plus a priority fee when a compute-budget
 * `SetComputeUnitPrice` (index 3, u64 micro-lamports) is present, over the
 * `SetComputeUnitLimit` (index 2, u32) or the default per-instruction budget.
 */
export function estimatedFeeLamports(tx: VersionedTransaction, lookupTables?: AddressLookupTableAccount[]): bigint {
  const message = tx.message;
  let fee = LAMPORTS_PER_SIGNATURE * BigInt(message.header.numRequiredSignatures);
  const computeBudget = ComputeBudgetProgram.programId;
  let price: bigint | undefined;
  let limit: bigint | undefined;
  let others = 0n;
  const keys = resolveAccountKeys(tx, lookupTables);
  for (const ix of message.compiledInstructions) {
    const programId = keys.get(ix.programIdIndex);
    if (!programId || !programId.equals(computeBudget)) {
      others += 1n;
      continue;
    }
    const data = Buffer.from(ix.data);
    if (data.length >= 5 && data[0] === 2) limit = BigInt(data.readUInt32LE(1));
    if (data.length >= 9 && data[0] === 3) price = data.readBigUInt64LE(1);
  }
  if (price !== undefined && price > 0n) {
    const units = limit ?? (others * DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION > MAX_COMPUTE_UNITS ? MAX_COMPUTE_UNITS : others * DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION);
    // Micro-lamports per unit, rounded up as the runtime does.
    fee += (units * price + 999_999n) / 1_000_000n;
  }
  return fee;
}

/** Every writable account the message touches, the owner first, capped for the RPC. */
function writableAddresses(
  tx: VersionedTransaction,
  lookupTables: AddressLookupTableAccount[],
  owner: PublicKey,
): { keys: PublicKey[]; partial: boolean } {
  const message = tx.message;
  const resolved = resolveAccountKeys(tx, lookupTables);
  const seen = new Set<string>([owner.toBase58()]);
  const keys: PublicKey[] = [owner];
  for (let i = 0; i < resolved.length; i += 1) {
    const key = resolved.get(i);
    if (!key || !message.isAccountWritable(i)) continue;
    const base58 = key.toBase58();
    if (seen.has(base58)) continue;
    seen.add(base58);
    keys.push(key);
  }
  if (keys.length <= MAX_SIMULATED_ACCOUNTS) return { keys, partial: false };
  return { keys: keys.slice(0, MAX_SIMULATED_ACCOUNTS), partial: true };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Decode first, then the network. Decoding never touches the RPC, so a dead
 * endpoint or a failed simulation still returns the decoded instructions and
 * their warnings for the user to read before deciding. Pipeline: deserialize →
 * lookup tables → resolve keys → decode → signer check → writable keys →
 * accounts before → simulate → mints touched → decimals → balance diff.
 */
export async function buildPreview(bytes: Uint8Array, deps: PreviewDeps): Promise<PreviewResult> {
  let tx: VersionedTransaction;
  try {
    tx = deserializeTransaction(bytes);
  } catch {
    return {
      success: false,
      error: 'Could not decode transaction',
      instructions: [],
      warnings: [UNREADABLE_TRANSACTION_WARNING],
      signerOk: false,
      unreadable: true,
    };
  }

  // A table the RPC cannot serve is not fatal: its instructions read as unreadable below.
  let lookupTables: AddressLookupTableAccount[] = [];
  const tableKeys = lookupTableKeys(tx);
  let tableError: string | undefined;
  if (tableKeys.length > 0) {
    try {
      lookupTables = await deps.fetchLookupTables(tableKeys);
    } catch (error) {
      tableError = errorText(error, 'Could not read address lookup tables');
    }
  }

  const raw = getInstructions(tx, lookupTables);
  const unreadable = raw.some((ix) => 'unreadable' in ix);
  const instructions = raw.map(decodeInstruction);
  const warnings = collectWarnings(instructions);
  const signerOk = requiredSigners(tx).some((key) => key.equals(deps.owner));
  const base = { instructions, warnings, signerOk, unreadable };

  if (!signerOk) {
    return { ...base, success: false, error: NOT_A_SIGNER_ERROR };
  }

  const { keys, partial } = writableAddresses(tx, lookupTables, deps.owner);
  const addresses = keys.map((key) => key.toBase58());

  let pre: Map<string, AccountInfo<Buffer> | null>;
  let value: SimulationValue;
  try {
    pre = await deps.fetchAccounts(keys);
    value = await deps.simulate(tx, addresses);
  } catch (error) {
    return { ...base, success: false, error: tableError ?? errorText(error, 'Simulation failed') };
  }

  const result: PreviewResult = {
    ...base,
    success: !value.err,
    error: value.err ? JSON.stringify(value.err) : tableError,
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed,
  };
  if (value.err || !value.accounts) return result;

  const post = new Map<string, PostAccount | null>();
  addresses.forEach((address, i) => {
    const account = value.accounts?.[i];
    post.set(
      address,
      account ? { owner: account.owner, lamports: account.lamports, data: Buffer.from(account.data[0] ?? '', 'base64') } : null,
    );
  });

  let decimals = new Map<string, number>();
  const mints = touchedMints(pre, post, deps.owner);
  if (mints.length > 0) {
    try {
      decimals = await deps.fetchMintDecimals(mints.map((mint) => new PublicKey(mint)));
    } catch {
      /* rows render in base units */
    }
  }

  const diff = balanceDiff(pre, post, deps.owner, decimals);
  result.diff = {
    sol: { pre: diff.sol.pre.toString(), post: diff.sol.post.toString() },
    tokens: diff.tokens.map((row) => ({
      mint: row.mint,
      pre: row.pre.toString(),
      post: row.post.toString(),
      decimals: row.decimals,
      programId: row.programId,
    })),
    fee: estimatedFeeLamports(tx, lookupTables).toString(),
    partial,
  };
  return result;
}
