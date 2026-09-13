/**
 * Convert a decimal amount string to an integer smallest-unit value.
 * Avoids float * 10^decimals precision loss.
 */
export function toSmallestUnit(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid amount');
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  const fracPadded = frac.padEnd(decimals, '0');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

export function fromSmallestUnit(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return neg ? `-${body}` : body;
}

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

export function formatLamports(lamports: bigint | number): string {
  const value = typeof lamports === 'number' ? BigInt(lamports) : lamports;
  return fromSmallestUnit(value, SOL_DECIMALS);
}

/** What a SOL send can carry once the fee is set aside; never below zero. */
export function maxSendable(balanceSmallest: bigint, feeSmallest: bigint): bigint {
  const max = balanceSmallest - feeSmallest;
  return max < 0n ? 0n : max;
}

/** What a one-signature transaction costs when no estimate has landed yet. */
export const FALLBACK_FEE_LAMPORTS = 5000n;

/**
 * The most of an asset a send can carry. A token moves in its own units, so the
 * whole balance goes; SOL pays the fee out of the same balance, so the fee comes
 * off first — and until the worker has priced a message, the fixed fallback stands
 * in, which is what Max would have used anyway.
 */
export function maxForAsset(balanceSmallest: bigint, feeLamports: bigint | null, isToken: boolean): bigint {
  if (isToken) return balanceSmallest < 0n ? 0n : balanceSmallest;
  return maxSendable(balanceSmallest, feeLamports ?? FALLBACK_FEE_LAMPORTS);
}

/** Digits with an optional point on either side: `0.5`, `.5`, `5`, `5.`. */
const AMOUNT_SHAPE = /^(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parse what the user typed into an amount in smallest units. Trims, accepts
 * `0.5` / `.5` / `5` / `5.`, and throws a line fit for the screen on anything
 * empty, zero, negative, non-numeric, or finer than `decimals`.
 */
export function parseAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter an amount');
  if (!AMOUNT_SHAPE.test(trimmed)) throw new Error('Enter a valid number');
  const [whole = '', frac = ''] = trimmed.split('.');
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places`);
  const value = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (value === 0n) throw new Error('Enter an amount');
  return value;
}
