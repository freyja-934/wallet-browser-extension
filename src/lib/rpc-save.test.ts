import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '../config/constants';
import type { WalletSettings } from './messages';
import { probeRefusal, saveRpcSettings, type RpcProbeResult, type SaveRpcDeps } from './rpc-save';

const URL_A = 'https://rpc-a.example/v1';
const URL_B = 'https://rpc-b.example';
const KEY = 'not-a-real-key';

interface Harness {
  deps: SaveRpcDeps;
  /** Every dependency call in order, as `name:argument`. */
  calls: string[];
  persisted: Partial<WalletSettings>[];
}

function harness(
  overrides: { probe?: RpcProbeResult; granted?: boolean; persistError?: Error } = {},
): Harness {
  const calls: string[] = [];
  const persisted: Partial<WalletSettings>[] = [];
  const probe = overrides.probe ?? { ok: true, genesisHash: GENESIS_HASH.devnet };
  const deps: SaveRpcDeps = {
    requestOrigin: (pattern) => {
      calls.push(`requestOrigin:${pattern}`);
      return Promise.resolve(overrides.granted ?? true);
    },
    removeOrigin: async (pattern) => {
      calls.push(`removeOrigin:${pattern}`);
    },
    probe: async (url) => {
      calls.push(`probe:${url}`);
      return probe;
    },
    persist: async (settings) => {
      calls.push('persist');
      if (overrides.persistError) throw overrides.persistError;
      persisted.push(settings);
    },
  };
  return { deps, calls, persisted };
}

describe('saveRpcSettings', () => {
  it('requests the origin synchronously, before anything is awaited', () => {
    const { deps, calls } = harness();
    const pending = saveRpcSettings({ rpcUrl: URL_A, heliusApiKey: '', cluster: 'devnet' }, deps);
    // No microtask has run yet: the request is the only call so far.
    expect(calls).toEqual(['requestOrigin:https://rpc-a.example/*']);
    return pending;
  });

  it('probes after the grant, then persists the URL, key, and cluster tag', async () => {
    const { deps, calls, persisted } = harness();
    await expect(
      saveRpcSettings({ rpcUrl: ` ${URL_A} `, heliusApiKey: ` ${KEY} `, cluster: 'devnet' }, deps),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['requestOrigin:https://rpc-a.example/*', `probe:${URL_A}`, 'persist']);
    expect(persisted).toEqual([{ rpcUrl: URL_A, heliusApiKey: KEY, rpcUrlCluster: 'devnet' }]);
  });

  it('refuses a non-https URL before asking for anything', async () => {
    const { deps, calls } = harness();
    await expect(saveRpcSettings({ rpcUrl: 'http://rpc.example', heliusApiKey: '', cluster: 'devnet' }, deps)).resolves.toEqual({
      ok: false,
      error: 'RPC URL must start with https://',
    });
    expect(calls).toEqual([]);
  });

  it('stops when the grant is refused, without probing or persisting', async () => {
    const { deps, calls } = harness({ granted: false });
    await expect(saveRpcSettings({ rpcUrl: URL_A, heliusApiKey: KEY, cluster: 'devnet' }, deps)).resolves.toEqual({
      ok: false,
      error: 'Access to that host was not granted',
    });
    expect(calls).toEqual(['requestOrigin:https://rpc-a.example/*']);
  });

  it('rolls the grant back and stores nothing when the probe fails', async () => {
    const { deps, calls, persisted } = harness({ probe: { ok: false, error: 'Endpoint answered HTTP 500' } });
    await expect(saveRpcSettings({ rpcUrl: URL_A, heliusApiKey: KEY, cluster: 'devnet' }, deps)).resolves.toEqual({
      ok: false,
      error: 'Endpoint answered HTTP 500',
    });
    expect(calls).toEqual([
      'requestOrigin:https://rpc-a.example/*',
      `probe:${URL_A}`,
      'removeOrigin:https://rpc-a.example/*',
    ]);
    expect(persisted).toEqual([]);
  });

  it('refuses an endpoint that serves the other cluster and rolls the grant back', async () => {
    const { deps, calls, persisted } = harness({ probe: { ok: true, genesisHash: GENESIS_HASH['mainnet-beta'] } });
    await expect(saveRpcSettings({ rpcUrl: URL_A, heliusApiKey: '', cluster: 'devnet' }, deps)).resolves.toEqual({
      ok: false,
      error: 'That endpoint serves Mainnet',
    });
    expect(calls).toContain('removeOrigin:https://rpc-a.example/*');
    expect(persisted).toEqual([]);
  });

  it('refuses an endpoint whose genesis hash belongs to no known cluster', async () => {
    const { deps } = harness({ probe: { ok: true, genesisHash: 'nope' } });
    await expect(saveRpcSettings({ rpcUrl: URL_A, heliusApiKey: '', cluster: 'devnet' }, deps)).resolves.toEqual({
      ok: false,
      error: 'That endpoint serves a different cluster',
    });
  });

  it('drops the old origin grant when the URL moves to a different origin', async () => {
    const { deps, calls } = harness();
    await saveRpcSettings({ rpcUrl: URL_B, heliusApiKey: '', cluster: 'devnet', previousRpcUrl: URL_A }, deps);
    expect(calls).toEqual([
      'requestOrigin:https://rpc-b.example/*',
      `probe:${URL_B}`,
      'persist',
      'removeOrigin:https://rpc-a.example/*',
    ]);
  });

  it('keeps the grant when the new URL is on the same origin', async () => {
    const { deps, calls } = harness();
    await saveRpcSettings(
      { rpcUrl: 'https://rpc-a.example/v2', heliusApiKey: '', cluster: 'devnet', previousRpcUrl: URL_A },
      deps,
    );
    expect(calls.filter((call) => call.startsWith('removeOrigin'))).toEqual([]);
  });

  it('with no URL: no permission, no probe; stores the key and drops the old grant', async () => {
    const { deps, calls, persisted } = harness();
    await expect(
      saveRpcSettings({ rpcUrl: '  ', heliusApiKey: KEY, cluster: 'mainnet-beta', previousRpcUrl: URL_A }, deps),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['persist', 'removeOrigin:https://rpc-a.example/*']);
    expect(persisted).toEqual([{ rpcUrl: '', heliusApiKey: KEY }]);
  });

  it('lets a worker rejection surface to the caller', async () => {
    const { deps } = harness({ persistError: new Error('Invalid settings.heliusApiKey') });
    await expect(saveRpcSettings({ rpcUrl: '', heliusApiKey: 'bad&key', cluster: 'devnet' }, deps)).rejects.toThrow(
      'Invalid settings.heliusApiKey',
    );
  });
});

describe('probeRefusal', () => {
  it('accepts only the active cluster', () => {
    expect(probeRefusal({ ok: true, genesisHash: GENESIS_HASH.devnet }, 'devnet')).toBeUndefined();
    expect(probeRefusal({ ok: true, genesisHash: GENESIS_HASH.devnet }, 'mainnet-beta')).toBe(
      'That endpoint serves Devnet',
    );
    expect(probeRefusal({ ok: true }, 'devnet')).toBe('That endpoint did not report a genesis hash');
    expect(probeRefusal({ ok: false }, 'devnet')).toBe('Could not reach that endpoint');
  });
});
