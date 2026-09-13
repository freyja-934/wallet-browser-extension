import type { Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  collectWarnings,
  decodeInstruction,
  deserializeTransaction,
  getInstructions,
  type DecodedInstruction,
  type PreviewWarning,
} from './tx-preview';

export interface SimulationValue {
  err: unknown;
  logs?: string[] | null;
  unitsConsumed?: number;
}

export type Simulate = (tx: Transaction | VersionedTransaction) => Promise<SimulationValue>;

export interface PreviewResult {
  /** True only when the simulation ran and reported no error. */
  success: boolean;
  /** Decode error, RPC error, or the simulation's own error. */
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
  instructions: DecodedInstruction[];
  warnings: PreviewWarning[];
}

export const UNREADABLE_TRANSACTION_WARNING: PreviewWarning = {
  level: 'danger',
  message: 'Unreadable transaction. Reject unless you trust this site.',
};

/**
 * Decode first, simulate second. Decoding never touches the network, so a dead
 * RPC or a failed simulation still returns the decoded instructions and their
 * warnings for the user to read before deciding.
 */
export async function buildPreview(bytes: Uint8Array, simulate: Simulate): Promise<PreviewResult> {
  let tx: VersionedTransaction;
  let instructions: DecodedInstruction[];
  let warnings: PreviewWarning[];
  try {
    tx = deserializeTransaction(bytes);
    instructions = getInstructions(tx).map(decodeInstruction);
    warnings = collectWarnings(instructions);
  } catch {
    return {
      success: false,
      error: 'Could not decode transaction',
      instructions: [],
      warnings: [UNREADABLE_TRANSACTION_WARNING],
    };
  }

  try {
    const value = await simulate(tx);
    return {
      success: !value.err,
      error: value.err ? JSON.stringify(value.err) : undefined,
      logs: value.logs ?? [],
      unitsConsumed: value.unitsConsumed,
      instructions,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Simulation failed';
    return { success: false, error: message, instructions, warnings };
  }
}
