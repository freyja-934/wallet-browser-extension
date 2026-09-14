import { describe, expect, it } from 'vitest';
import { JUPITER_BALANCES_URL, JUPITER_TOKEN_SEARCH_URL, jupiterEnabledFor } from './constants';

/**
 * The gate on the one third party this wallet talks to about an address. It is
 * deliberately narrow: mainnet only, and only for a user who configured nothing.
 */
describe('jupiterEnabledFor', () => {
  it('is on for a mainnet install that has configured nothing', () => {
    expect(jupiterEnabledFor('mainnet-beta', {})).toBe(true);
    expect(jupiterEnabledFor('mainnet-beta')).toBe(true);
  });

  it('is off on devnet, whose addresses Jupiter does not index', () => {
    expect(jupiterEnabledFor('devnet', {})).toBe(false);
  });

  it('is off when the user named their own RPC URL', () => {
    expect(jupiterEnabledFor('mainnet-beta', { rpcUrl: 'https://rpc.example/v1' })).toBe(false);
  });

  it('is off for a custom URL tagged for the other cluster: the user still chose an endpoint', () => {
    expect(
      jupiterEnabledFor('mainnet-beta', { rpcUrl: 'https://rpc.example/v1', rpcUrlCluster: 'devnet' }),
    ).toBe(false);
  });

  it('is off when the user entered a Helius key', () => {
    expect(jupiterEnabledFor('mainnet-beta', { heliusApiKey: 'a-key' })).toBe(false);
  });

  it('treats an empty string as nothing configured, the shape Settings clears to', () => {
    expect(jupiterEnabledFor('mainnet-beta', { rpcUrl: '', heliusApiKey: '' })).toBe(true);
  });
});

describe('the Jupiter endpoints', () => {
  it('are https on the host the manifest grants', () => {
    for (const url of [JUPITER_BALANCES_URL, JUPITER_TOKEN_SEARCH_URL]) {
      expect(new URL(url).protocol).toBe('https:');
      expect(new URL(url).host).toBe('lite-api.jup.ag');
    }
  });
});
