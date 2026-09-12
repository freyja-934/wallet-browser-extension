import {
  ComputeBudgetProgram,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
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

/** A compiled instruction whose accounts this preview cannot resolve (lookup tables arrive later). */
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

export function deserializeTransaction(bytes: Uint8Array): Transaction | VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export function getInstructions(tx: Transaction | VersionedTransaction): PreviewInstruction[] {
  if (tx instanceof VersionedTransaction) {
    return TransactionMessageCompat(tx);
  }
  return tx.instructions;
}

function TransactionMessageCompat(tx: VersionedTransaction): PreviewInstruction[] {
  try {
    const message = tx.message;
    const keys = message.staticAccountKeys;
    return message.compiledInstructions.map((ix): PreviewInstruction => {
      // Indexes past the static keys point into address lookup tables, which we do not fetch yet.
      const indexes = [ix.programIdIndex, ...ix.accountKeyIndexes];
      if (indexes.some((index) => index >= keys.length)) {
        return { unreadable: true, reason: UNREADABLE_REASON };
      }
      return {
        programId: keys[ix.programIdIndex],
        keys: ix.accountKeyIndexes.map((index) => ({
          pubkey: keys[index],
          isSigner: message.isAccountSigner(index),
          isWritable: message.isAccountWritable(index),
        })),
        data: Buffer.from(ix.data),
      };
    });
  } catch {
    return [{ unreadable: true, reason: UNREADABLE_REASON }];
  }
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

export function isVersioned(tx: Transaction | VersionedTransaction): tx is VersionedTransaction {
  return tx instanceof VersionedTransaction;
}
