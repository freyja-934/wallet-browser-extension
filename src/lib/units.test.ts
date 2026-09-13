import { describe, expect, it } from 'vitest';
import { FALLBACK_FEE_LAMPORTS, formatLamports, fromSmallestUnit, maxForAsset, maxSendable, parseAmount, toSmallestUnit } from './units';

describe('toSmallestUnit', () => {
  it('converts SOL amounts without float error', () => {
    expect(toSmallestUnit('1.5', 9)).toBe(1_500_000_000n);
    expect(toSmallestUnit('0.000000001', 9)).toBe(1n);
  });

  it('rejects extra decimals', () => {
    expect(() => toSmallestUnit('1.1234567890', 9)).toThrow();
  });
});

describe('fromSmallestUnit', () => {
  it('round-trips', () => {
    expect(fromSmallestUnit(1_500_000_000n, 9)).toBe('1.5');
  });
});

describe('formatLamports', () => {
  it('formats integer lamports as SOL', () => {
    expect(formatLamports(5000)).toBe('0.000005');
  });
});

describe('maxSendable', () => {
  it('subtracts the fee from the balance', () => {
    expect(maxSendable(1_000_000_000n, 5000n)).toBe(999_995_000n);
  });

  it('never goes below zero', () => {
    expect(maxSendable(4000n, 5000n)).toBe(0n);
    expect(maxSendable(0n, 5000n)).toBe(0n);
    expect(maxSendable(5000n, 5000n)).toBe(0n);
  });

  it('round-trips through the parser', () => {
    const max = maxSendable(113_456_700n, 5000n);
    expect(parseAmount(fromSmallestUnit(max, 9), 9)).toBe(max);
  });
});

describe('maxForAsset', () => {
  it('sends a token balance whole, fee or no fee', () => {
    expect(maxForAsset(1_500_000n, 5000n, true)).toBe(1_500_000n);
    expect(maxForAsset(1_500_000n, null, true)).toBe(1_500_000n);
    expect(maxForAsset(1n, 10_000n, true)).toBe(1n);
  });

  it('takes the fee off a SOL balance', () => {
    expect(maxForAsset(1_000_000_000n, 7000n, false)).toBe(999_993_000n);
  });

  it('falls back to 5000 lamports when no estimate has landed', () => {
    expect(FALLBACK_FEE_LAMPORTS).toBe(5000n);
    expect(maxForAsset(1_000_000_000n, null, false)).toBe(999_995_000n);
  });

  it('is zero when the SOL balance cannot cover the fee', () => {
    expect(maxForAsset(5000n, 5000n, false)).toBe(0n);
    expect(maxForAsset(4999n, null, false)).toBe(0n);
    expect(maxForAsset(0n, null, false)).toBe(0n);
  });
});

describe('parseAmount', () => {
  it('accepts the shapes a user types', () => {
    expect(parseAmount('0.5', 9)).toBe(500_000_000n);
    expect(parseAmount('.5', 9)).toBe(500_000_000n);
    expect(parseAmount('5', 9)).toBe(5_000_000_000n);
    expect(parseAmount('5.', 9)).toBe(5_000_000_000n);
    expect(parseAmount('  0.001 ', 9)).toBe(1_000_000n);
    expect(parseAmount('7', 0)).toBe(7n);
  });

  it('rejects empty and zero with "Enter an amount"', () => {
    for (const input of ['', '   ', '0', '0.0', '.0', '0.']) {
      expect(() => parseAmount(input, 9)).toThrow('Enter an amount');
    }
  });

  it('rejects negative and non-numeric input', () => {
    for (const input of ['-1', '-0.5', 'abc', '1e9', '1,5', '1.2.3', '.', '0x10', '1 SOL']) {
      expect(() => parseAmount(input, 9)).toThrow('Enter a valid number');
    }
  });

  it('rejects more fraction digits than the asset has', () => {
    expect(() => parseAmount('0.1234567891', 9)).toThrow('Use at most 9 decimal places');
    expect(() => parseAmount('1.0000001', 6)).toThrow('Use at most 6 decimal places');
    expect(() => parseAmount('1.0', 0)).toThrow('Use at most 0 decimal places');
    expect(parseAmount('0.123456789', 9)).toBe(123_456_789n);
  });
});
