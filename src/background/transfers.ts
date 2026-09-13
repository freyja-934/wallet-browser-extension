import {
  ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { getCluster, rpcUrlsFor } from '../config/constants';
import { errorMessage } from '../lib/errors';
import { SendError, type FeeEstimate, type RecipientInfo } from '../lib/protocol';
import { readyConnection } from '../lib/rpc-rotate';
import { FALLBACK_FEE_LAMPORTS, formatLamports } from '../lib/units';
import { getSettings, getKeypair } from './keyring';

export async function getConnection(): Promise<Connection> {
  const settings = await getSettings();
  return readyConnection(rpcUrlsFor(settings.cluster ?? getCluster(), settings));
}

export interface TransferParams {
  to: string;
  amountSmallest: string;
  mint?: string;
  /**
   * The token account the tokens leave. The popup sends the row the user picked,
   * which is not always the associated token account; omitted, the signer's ATA
   * is used.
   */
  source?: string;
}

/** The signer the worker holds and the connection it resolved. Tests pass fakes; production omits it. */
export interface TransferIo {
  connection: Connection;
  signer: Keypair;
}

/** What a one-signature transaction costs when the RPC will not say; the same figure Max uses. */
export { FALLBACK_FEE_LAMPORTS };
export const CONFIRM_POLL_MS = 400;
/** Hard cap on the confirmation loop; the block-height check normally ends it well before. */
export const CONFIRM_TIMEOUT_MS = 90_000;
export const EXPIRED_MESSAGE = 'Transaction expired before confirmation; safe to retry';
export const TIMED_OUT_MESSAGE = 'Confirmation timed out. Check the explorer before retrying.';

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

async function defaultIo(): Promise<TransferIo> {
  return { signer: await getKeypair(), connection: await getConnection() };
}

interface ParsedTransfer {
  to: PublicKey;
  amount: bigint;
  mint?: PublicKey;
  source?: PublicKey;
}

function parseParams(params: TransferParams): ParsedTransfer {
  let to: PublicKey;
  try {
    to = new PublicKey(params.to);
  } catch {
    throw new Error('Invalid recipient address');
  }
  const amount = BigInt(params.amountSmallest);
  if (!params.mint) return { to, amount };
  let mint: PublicKey;
  try {
    mint = new PublicKey(params.mint);
  } catch {
    throw new Error('Invalid mint address');
  }
  if (params.source === undefined) return { to, amount, mint };
  let source: PublicKey;
  try {
    source = new PublicKey(params.source);
  } catch {
    throw new Error('Invalid source address');
  }
  return { to, amount, mint, source };
}

/** SPL Token or Token-2022 from the mint's owner; anything else is not a token this wallet can move. */
function tokenProgramOf(owner: PublicKey): PublicKey {
  if (owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error('Unknown token program');
}

export interface BuiltTransfer {
  /** Fee payer set; no blockhash yet, the caller stamps one. */
  transaction: Transaction;
  /** Present for a token send: the program the mint lives under and its decimals. */
  mint?: { programId: PublicKey; decimals: number };
  /** Present for a token send: the account the transfer credits, so an estimate can see whether it exists. */
  destination?: PublicKey;
}

/**
 * The exact transaction a send would broadcast, so an estimate prices the same
 * message. SOL is a system transfer. A token send derives both associated token
 * accounts under the mint's own program (off-curve owners allowed, so a PDA can
 * receive), creates the recipient's idempotently, and moves the amount with a
 * checked transfer that carries the mint's decimals.
 */
export async function buildTransfer(connection: Connection, signer: Keypair, params: ParsedTransfer): Promise<BuiltTransfer> {
  const transaction = new Transaction();
  transaction.feePayer = signer.publicKey;

  if (!params.mint) {
    // web3.js takes lamports as a bigint, so no amount a u64 can hold has to round-trip through a number.
    transaction.add(
      SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: params.to, lamports: params.amount }),
    );
    return { transaction };
  }

  const mintInfo = await connection.getAccountInfo(params.mint, 'confirmed');
  if (!mintInfo) throw new Error('Mint not found');
  const programId = tokenProgramOf(mintInfo.owner);
  const { decimals } = await getMint(connection, params.mint, 'confirmed', programId);
  const source = params.source
    ? await checkedSource(connection, params.source, signer.publicKey, params.mint, programId)
    : getAssociatedTokenAddressSync(params.mint, signer.publicKey, true, programId);
  const destination = getAssociatedTokenAddressSync(params.mint, params.to, true, programId);
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, destination, params.to, params.mint, programId),
    createTransferCheckedInstruction(source, params.mint, destination, signer.publicKey, params.amount, decimals, [], programId),
  );
  return { transaction, mint: { programId, decimals }, destination };
}

/**
 * A caller-supplied source only spends what the signer owns: the account must
 * exist under this mint's program, hold this mint, and be owned by the signer.
 * Anything else is a stale or mistaken row, not an account this wallet can move.
 */
async function checkedSource(
  connection: Connection,
  source: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
): Promise<PublicKey> {
  let account: Awaited<ReturnType<typeof getAccount>>;
  try {
    account = await getAccount(connection, source, 'confirmed', programId);
  } catch {
    throw new Error('Token account mismatch');
  }
  if (!account.owner.equals(owner) || !account.mint.equals(mint)) throw new Error('Token account mismatch');
  return source;
}

/**
 * What the chain says about the recipient; the popup warns on the shapes a wallet
 * address should not have. For a token send `destination` is the recipient's
 * associated token account, and `exists` is about that account — whether this
 * send has to create (and pay rent for) it — while `walletExists` stays about the
 * address the user typed.
 */
async function recipientInfo(connection: Connection, to: PublicKey, destination?: PublicKey): Promise<RecipientInfo> {
  const [wallet, credited] = await Promise.all([
    connection.getAccountInfo(to, 'confirmed'),
    destination ? connection.getAccountInfo(destination, 'confirmed') : null,
  ]);
  return {
    exists: (destination ? credited : wallet) !== null,
    walletExists: wallet !== null,
    isTokenAccount: wallet !== null && TOKEN_PROGRAMS.has(wallet.owner.toBase58()),
    offCurve: !PublicKey.isOnCurve(to.toBytes()),
  };
}

/** The network fee for `transaction` at `blockhash`; the fixed fallback when the RPC declines to say. */
async function feeFor(connection: Connection, transaction: Transaction, blockhash: string): Promise<bigint> {
  transaction.recentBlockhash = blockhash;
  const message = transaction.compileMessage();
  try {
    const { value } = await connection.getFeeForMessage(message, 'confirmed');
    return value === null ? FALLBACK_FEE_LAMPORTS : BigInt(value);
  } catch {
    return FALLBACK_FEE_LAMPORTS;
  }
}

/** What an account of `size` bytes must hold to be rent-exempt: 0 for a bare system account. */
async function rentExemptMin(connection: Connection, size = 0): Promise<bigint> {
  return BigInt(await connection.getMinimumBalanceForRentExemption(size));
}

/**
 * Price a send without broadcasting it. The blockhash fetched here is only for
 * the fee lookup; the send fetches its own.
 */
export async function estimateTransfer(params: TransferParams, io?: TransferIo): Promise<FeeEstimate> {
  const { connection, signer } = io ?? (await defaultIo());
  const parsed = parseParams(params);
  const { transaction, destination } = await buildTransfer(connection, signer, parsed);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const [feeLamports, rent, recipient] = await Promise.all([
    feeFor(connection, transaction, blockhash),
    // A token send may have to create a token account of the mint's program, not a bare one.
    rentExemptMin(connection, parsed.mint ? ACCOUNT_SIZE : 0),
    recipientInfo(connection, parsed.to, destination),
  ]);
  return { feeLamports: feeLamports.toString(), rentExemptMin: rent.toString(), recipient };
}

/**
 * A SOL send must leave both sides rent-exempt or empty: the sender may keep
 * nothing at all or at least the minimum, never something in between (the
 * runtime refuses that), and a recipient that does not exist yet must receive
 * the minimum to be created.
 */
async function assertSolRent(
  connection: Connection,
  sender: PublicKey,
  parsed: ParsedTransfer,
  fee: bigint,
): Promise<void> {
  const [rent, balance, recipient] = await Promise.all([
    rentExemptMin(connection),
    connection.getBalance(sender, 'confirmed').then(BigInt),
    recipientInfo(connection, parsed.to),
  ]);
  const remaining = balance - parsed.amount - fee;
  if (remaining < 0n) throw new Error('Insufficient balance for the amount plus the network fee');
  if (remaining > 0n && remaining < rent) throw new Error(`Leave at least ${formatLamports(rent)} SOL or send Max`);
  if (!recipient.exists && parsed.amount < rent) throw new Error(`New accounts need at least ${formatLamports(rent)} SOL`);
}

export async function sendTransfer(params: TransferParams, io?: TransferIo): Promise<string> {
  const { connection, signer } = io ?? (await defaultIo());
  const parsed = parseParams(params);
  const { transaction } = await buildTransfer(connection, signer, parsed);
  const latest = await connection.getLatestBlockhash('confirmed');
  if (!parsed.mint) {
    const fee = await feeFor(connection, transaction, latest.blockhash);
    await assertSolRent(connection, signer.publicKey, parsed, fee);
  }
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } catch (error) {
    // The fee payer's signature *is* the transaction's id, and it exists before the
    // broadcast: a send that failed on the way out may still have reached the cluster,
    // so name it rather than leaving the user nothing to look up.
    throw new SendError('broadcast-failed', errorMessage(error, 'Broadcast failed'), signatureOf(transaction));
  }
  return confirmTransfer(connection, signature, latest.lastValidBlockHeight);
}

/** The signed transaction's own id, base58; `undefined` if it somehow carries no signature. */
function signatureOf(transaction: Transaction): string | undefined {
  return transaction.signature ? bs58.encode(transaction.signature) : undefined;
}

/** One look at the signature's status. `history` widens the search past the recent-status window. */
async function statusOf(connection: Connection, signature: string, history: boolean) {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: history });
  return value[0] ?? null;
}

/**
 * Poll until the signature is confirmed, has failed on-chain, or can no longer
 * land because the chain has moved past the blockhash's last valid height. The
 * poll reads the recent-status window only — `searchTransactionHistory` is a
 * ledger scan, too heavy for a 400 ms loop — so before calling a send expired
 * there is one history lookup: the transaction may have landed in the seconds
 * between the last status read and the height check, and declaring that expired
 * would invite the user to send twice. Transient RPC errors are retried until
 * the hard cap; whatever the outcome, the failure carries the signature so the
 * popup can point at the explorer.
 */
async function confirmTransfer(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<string> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    try {
      const status = await statusOf(connection, signature, false);
      if (status?.err) throw new OnChainError(status.err);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
      if ((await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) {
        const landed = await statusOf(connection, signature, true);
        if (landed?.err) throw new OnChainError(landed.err);
        // Found at all means it is in the ledger; the blockhash cannot replay it.
        if (landed) return signature;
        throw new SendError('expired', EXPIRED_MESSAGE, signature);
      }
    } catch (error) {
      if (error instanceof OnChainError || error instanceof SendError) throw error;
      /* transient RPC failure: try again until the cap */
    }
    if (Date.now() >= deadline) throw new SendError('timeout', TIMED_OUT_MESSAGE, signature);
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }
}

class OnChainError extends Error {
  constructor(err: unknown) {
    super(`Transaction failed on-chain: ${JSON.stringify(err)}`);
  }
}
