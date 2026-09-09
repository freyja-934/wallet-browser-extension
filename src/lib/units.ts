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
