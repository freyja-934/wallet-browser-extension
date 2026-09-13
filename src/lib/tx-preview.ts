import {
  ComputeBudgetProgram,
  MessageAccountKeys,
  SystemProgram,
  TransactionInstruction,
  VersionedMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type PublicKey,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const KNOWN_PROGRAMS: Record<string, string> = {
  [SystemProgram.programId.toBase58()]: 'System Program',
  [TOKEN_PROGRAM_ID.toBase58()]: 'Token Program',
  [TOKEN_2022_PROGRAM_ID.toBase58()]: 'Token-2022 Program',
  [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]: 'Associated Token Account',
  [ComputeBudgetProgram.programId.toBase58()]: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
};

export interface DecodedInstruction {
  programId: string;
  programName: string;
  label: string;
  known: boolean;
  warning?: string;
}

export interface PreviewWarning {
  level: 'warn' | 'danger';
  message: string;
}

/** A compiled instruction whose accounts this preview cannot resolve (a lookup table it could not fetch, or a malformed message). */
export interface UnreadableInstruction {
  unreadable: true;
  reason: string;
}

export type PreviewInstruction = TransactionInstruction | UnreadableInstruction;

const UNREADABLE_REASON =
  'Instruction references accounts this preview cannot resolve (address lookup table or malformed message). Reject unless you trust this site.';

/** System Program instruction index (u32 little-endian) to label and optional warning. */
const SYSTEM_INSTRUCTIONS: Record<number, { label: string; warning?: string }> = {
  1: { label: 'Assign account', warning: 'This instruction can change account ownership.' },
  2: { label: 'Transfer SOL' },
  3: { label: 'Create account with seed' },
  10: { label: 'Assign account with seed', warning: 'This instruction can change account ownership.' },
  11: { label: 'Transfer SOL (seed)' },
};

/** Token and Token-2022 instruction index (u8) to label and optional warning. */
const TOKEN_INSTRUCTIONS: Record<number, { label: string; warning?: string }> = {
  3: { label: 'Transfer tokens' },
  4: { label: 'Approve delegate', warning: 'Approves another account to spend tokens.' },
  5: { label: 'Revoke delegate' },
  6: { label: 'Set authority', warning: 'Can change mint or account authority.' },
  7: { label: 'Mint tokens' },
  8: { label: 'Burn tokens' },
  9: { label: 'Close token account', warning: 'Closes a token account and sends its lamports elsewhere.' },
  10: { label: 'Freeze token account', warning: 'Freezes a token account so it can no longer move tokens.' },
  11: { label: 'Thaw token account' },
  12: { label: 'Transfer tokens (checked)' },
  13: { label: 'Approve delegate (checked)', warning: 'Approves another account to spend tokens.' },
  14: { label: 'Mint tokens (checked)' },
  15: { label: 'Burn tokens (checked)' },
};

/** `VersionedTransaction.deserialize` accepts legacy wire bytes as well as v0, so there is one path. */
export function deserializeTransaction(bytes: Uint8Array): VersionedTransaction {
  return VersionedTransaction.deserialize(bytes);
}

/**
 * The keys a message can address: the static keys, plus the lookup-table
 * entries once the tables are supplied. A v0 message whose tables are missing
 * (or that names a table we were not given) falls back to its static keys, so
 * only the instructions that reach into a table read as unreadable.
 */
export function resolveAccountKeys(
  tx: VersionedTransaction,
  lookupTables?: AddressLookupTableAccount[],
): MessageAccountKeys {
  const message = tx.message;
  if (message.version === 'legacy') return message.getAccountKeys();
  if (message.addressTableLookups.length === 0) return message.getAccountKeys();
  try {
    return message.getAccountKeys({ addressLookupTableAccounts: lookupTables ?? [] });
  } catch {
    return new MessageAccountKeys(message.staticAccountKeys);
  }
}

/** The lookup tables a v0 message references (none for legacy), for the caller to fetch. */
export function lookupTableKeys(tx: VersionedTransaction): PublicKey[] {
  return tx.message.addressTableLookups.map((lookup) => lookup.accountKey);
}

export function getInstructions(
  tx: VersionedTransaction,
  lookupTables?: AddressLookupTableAccount[],
): PreviewInstruction[] {
  try {
    const message = tx.message;
    const keys = resolveAccountKeys(tx, lookupTables);
    return message.compiledInstructions.map((ix): PreviewInstruction => {
      const programId = keys.get(ix.programIdIndex);
      const accounts = ix.accountKeyIndexes.map((index) => keys.get(index));
      // A key still missing after resolution points into a table we could not read.
      if (!programId || accounts.some((key) => key === undefined)) {
        return { unreadable: true, reason: UNREADABLE_REASON };
      }
      return new TransactionInstruction({
        programId,
        keys: accounts.map((pubkey, i) => ({
          pubkey: pubkey!,
          isSigner: message.isAccountSigner(ix.accountKeyIndexes[i]),
          isWritable: message.isAccountWritable(ix.accountKeyIndexes[i]),
        })),
        data: Buffer.from(ix.data),
      });
    });
  } catch {
    return [{ unreadable: true, reason: UNREADABLE_REASON }];
  }
}

/** The accounts whose signatures the message requires: the first `numRequiredSignatures` static keys. */
export function requiredSigners(tx: VersionedTransaction): PublicKey[] {
  const message = tx.message;
  return message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
}

/**
 * True when `bytes` are exactly a serialized transaction message (legacy or v0):
 * they parse, and the parsed message serializes back to the same bytes. The
 * runtime verifies a transaction's signatures over the re-serialized message,
 * so this is precisely the case where an ed25519 signature over `bytes` would
 * also be a valid transaction signature. The signMessage guard.
 */
export function isTransactionMessage(bytes: Uint8Array): boolean {
  let message: VersionedMessage;
  try {
    message = VersionedMessage.deserialize(bytes);
  } catch {
    return false;
  }
  const again = message.serialize();
  if (again.length !== bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (again[i] !== bytes[i]) return false;
  }
  return true;
}

export function decodeInstruction(ix: PreviewInstruction): DecodedInstruction {
  if ('unreadable' in ix) {
    return {
      programId: '',
      programName: 'Unknown program',
      label: 'Unreadable instruction',
      known: false,
      warning: ix.reason,
    };
  }

  const programId = ix.programId.toBase58();
  const programName = KNOWN_PROGRAMS[programId] ?? 'Unknown program';
  const known = programId in KNOWN_PROGRAMS;
  let label = known ? programName : `Unknown (${programId.slice(0, 4)}…${programId.slice(-4)})`;
  let warning: string | undefined;

  if (programId === SystemProgram.programId.toBase58()) {
    // System encodes its instruction index as a u32 little-endian.
    const entry = ix.data.length >= 4 ? SYSTEM_INSTRUCTIONS[ix.data.readUInt32LE(0)] : undefined;
    if (entry) ({ label, warning } = entry);
  }

  if (programId === TOKEN_PROGRAM_ID.toBase58() || programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
    // Token and Token-2022 encode theirs as a single u8.
    const entry = ix.data.length >= 1 ? TOKEN_INSTRUCTIONS[ix.data[0]] : undefined;
    if (entry) ({ label, warning } = entry);
  }

  if (!known) {
    warning = 'Unknown program. Inspect the simulation result before approving.';
  }

  return { programId, programName, label, known, warning };
}

export function collectWarnings(instructions: DecodedInstruction[]): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  for (const ix of instructions) {
    if (ix.warning && !ix.known) {
      warnings.push({ level: 'danger', message: ix.warning });
    } else if (ix.warning) {
      warnings.push({ level: 'warn', message: `${ix.label}: ${ix.warning}` });
    }
  }
  return warnings;
}
