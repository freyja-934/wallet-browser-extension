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

export function deserializeTransaction(bytes: Uint8Array): Transaction | VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export function getInstructions(tx: Transaction | VersionedTransaction): TransactionInstruction[] {
  if (tx instanceof VersionedTransaction) {
    return TransactionMessageCompat(tx);
  }
  return tx.instructions;
}

function TransactionMessageCompat(tx: VersionedTransaction): TransactionInstruction[] {
  try {
    const message = tx.message;
    const keys = message.staticAccountKeys;
    return message.compiledInstructions.map((ix) => ({
      programId: keys[ix.programIdIndex],
      keys: ix.accountKeyIndexes.map((index) => ({
        pubkey: keys[index],
        isSigner: message.isAccountSigner(index),
        isWritable: message.isAccountWritable(index),
      })),
      data: Buffer.from(ix.data),
    }));
  } catch {
    return [];
  }
}

export function decodeInstruction(ix: TransactionInstruction): DecodedInstruction {
  const programId = ix.programId.toBase58();
  const programName = KNOWN_PROGRAMS[programId] ?? 'Unknown program';
  const known = programId in KNOWN_PROGRAMS;
  let label = known ? programName : `Unknown (${programId.slice(0, 4)}…${programId.slice(-4)})`;
  let warning: string | undefined;

  if (programId === SystemProgram.programId.toBase58()) {
    const type = ix.data[0];
    if (type === 2) label = 'Transfer SOL';
    if (type === 3) {
      label = 'Assign account';
      warning = 'This instruction can change account ownership.';
    }
  }

  if (programId === TOKEN_PROGRAM_ID.toBase58() || programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
    const type = ix.data[0];
    if (type === 4 || type === 12) label = 'Transfer tokens';
    if (type === 3) {
      label = 'Approve delegate';
      warning = 'Approves another account to spend tokens.';
    }
    if (type === 6) {
      label = 'Set authority / MintTo';
      warning = 'Can change mint or account authority.';
    }
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
