import { describe, expect, it } from 'vitest';
import { formatLamports, fromSmallestUnit, toSmallestUnit } from './units';

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
