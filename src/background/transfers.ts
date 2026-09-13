import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getCluster, rpcUrlsFor } from '../config/constants';
import { errorMessage } from '../lib/errors';
import type { FeeEstimate, RecipientInfo } from '../lib/protocol';
import { readyConnection } from '../lib/rpc-rotate';
import { formatLamports } from '../lib/units';
import { getSettings, getKeypair } from './keyring';

export async function getConnection(): Promise<Connection> {
  const settings = await getSettings();
  return readyConnection(rpcUrlsFor(settings.cluster ?? getCluster(), settings));
}

export interface TransferParams {
  to: string;
  amountSmallest: string;
  mint?: string;
}

/** The signer the worker holds and the connection it resolved. Tests pass fakes; production omits it. */
export interface TransferIo {
  connection: Connection;
  signer: Keypair;
}

/** What a one-signature transaction costs when the RPC will not say. */
export const FALLBACK_FEE_LAMPORTS = 5000n;
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
  return { to, amount, mint };
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
    if (params.amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount too large');
    transaction.add(
      SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: params.to, lamports: Number(params.amount) }),
    );
    return { transaction };
  }

  const mintInfo = await connection.getAccountInfo(params.mint, 'confirmed');
  if (!mintInfo) throw new Error('Mint not found');
  const programId = tokenProgramOf(mintInfo.owner);
  const { decimals } = await getMint(connection, params.mint, 'confirmed', programId);
  const source = getAssociatedTokenAddressSync(params.mint, signer.publicKey, true, programId);
  const destination = getAssociatedTokenAddressSync(params.mint, params.to, true, programId);
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, destination, params.to, params.mint, programId),
    createTransferCheckedInstruction(source, params.mint, destination, signer.publicKey, params.amount, decimals, [], programId),
  );
  return { transaction, mint: { programId, decimals } };
}

/** What the chain says about the recipient; the popup warns on the shapes a wallet address should not have. */
async function recipientInfo(connection: Connection, to: PublicKey): Promise<RecipientInfo> {
  const info = await connection.getAccountInfo(to, 'confirmed');
  return {
    exists: info !== null,
    isTokenAccount: info !== null && TOKEN_PROGRAMS.has(info.owner.toBase58()),
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

async function rentExemptMin(connection: Connection): Promise<bigint> {
  return BigInt(await connection.getMinimumBalanceForRentExemption(0));
}

/**
 * Price a send without broadcasting it. The blockhash fetched here is only for
 * the fee lookup; the send fetches its own.
 */
export async function estimateTransfer(params: TransferParams, io?: TransferIo): Promise<FeeEstimate> {
  const { connection, signer } = io ?? (await defaultIo());
  const parsed = parseParams(params);
  const { transaction } = await buildTransfer(connection, signer, parsed);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const [feeLamports, rent, recipient] = await Promise.all([
    feeFor(connection, transaction, blockhash),
    rentExemptMin(connection),
    recipientInfo(connection, parsed.to),
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
    throw new Error(errorMessage(error, 'Broadcast failed'));
  }
  return confirmTransfer(connection, signature, latest.lastValidBlockHeight);
}

/**
 * Poll until the signature is confirmed, has failed on-chain, or can no longer
 * land because the chain has moved past the blockhash's last valid height.
 * Transient RPC errors are retried until the hard cap.
 */
async function confirmTransfer(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<string> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    try {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value[0];
      if (status?.err) throw new OnChainError(status.err);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
      if ((await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error(EXPIRED_MESSAGE);
    } catch (error) {
      if (error instanceof OnChainError || (error instanceof Error && error.message === EXPIRED_MESSAGE)) throw error;
      /* transient RPC failure: try again until the cap */
    }
    if (Date.now() >= deadline) throw new Error(TIMED_OUT_MESSAGE);
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }
}

class OnChainError extends Error {
  constructor(err: unknown) {
    super(`Transaction failed on-chain: ${JSON.stringify(err)}`);
  }
}
