import { describe, expect, it } from 'vitest';
import { isDappMessageType, isExtensionMessageType } from './messages';

describe('message allowlist', () => {
  it('allows dApp signing types', () => {
    expect(isDappMessageType('SIGN_TRANSACTION')).toBe(true);
    expect(isDappMessageType('SIGN_MESSAGE')).toBe(true);
  });

  it('rejects unknown types from pages', () => {
    expect(isDappMessageType('CLEAR_WALLET')).toBe(false);
    expect(isDappMessageType('EXPORT_SEED')).toBe(false);
    expect(isDappMessageType('APPROVE_REQUEST')).toBe(false);
    expect(isExtensionMessageType('CLEAR_WALLET')).toBe(true);
    expect(isExtensionMessageType('EXPORT_SEED')).toBe(true);
    expect(isExtensionMessageType('POLL_APPROVAL')).toBe(true);
    expect(isDappMessageType('POLL_APPROVAL')).toBe(false);
  });
});
