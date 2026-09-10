import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  heliusRpcUrlFor,
  PUBLIC_DEVNET_RPC,
  PUBLIC_SOLANA_RPC,
  rpcUrlsFor,
} from '../config/constants';
import {
  markRpcUnhealthy,
  prioritizeRpcUrls,
  resetRpcCooldowns,
  rpcJson,
} from './rpc-rotate';

afterEach(() => {
  resetRpcCooldowns();
  vi.unstubAllGlobals();
});

describe('rpcUrlsFor', () => {
  it('always ends with the public Solana RPC for the cluster', () => {
    expect(rpcUrlsFor('devnet').at(-1)).toBe(PUBLIC_DEVNET_RPC);
    expect(rpcUrlsFor('mainnet-beta').at(-1)).toBe(PUBLIC_SOLANA_RPC);
  });

  it('puts Helius first when a key is baked in', () => {
    const helius = heliusRpcUrlFor('devnet');
    if (!helius) return;
    expect(rpcUrlsFor('devnet')[0]).toBe(helius);
    expect(rpcUrlsFor('devnet')).toHaveLength(2);
  });
});

describe('prioritizeRpcUrls', () => {
  it('keeps cooled endpoints last', () => {
    markRpcUnhealthy('https://a.example', 1_000);
    expect(prioritizeRpcUrls(['https://a.example', 'https://b.example'], 1_001)).toEqual([
      'https://b.example',
      'https://a.example',
    ]);
  });

  it('uses the original order once the cooldown expires', () => {
    markRpcUnhealthy('https://a.example', 1_000);
    expect(prioritizeRpcUrls(['https://a.example', 'https://b.example'], 40_000)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('rpcJson', () => {
  it('rotates to the next URL after 503', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('helius')) {
        return new Response('nope', { status: 503 });
      }
      return Response.json({ jsonrpc: '2.0', id: 'cinder', result: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await rpcJson<{ ok: boolean }>('devnet', 'getHealth', [], {
      urls: [
        'https://devnet.helius-rpc.com/?api-key=test',
        PUBLIC_DEVNET_RPC,
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not rotate a 400 to the public RPC', async () => {
    const fetchMock = vi.fn(async () => new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(rpcJson('devnet', 'getHealth', [], {
      urls: [
        'https://devnet.helius-rpc.com/?api-key=test',
        PUBLIC_DEVNET_RPC,
      ],
    })).rejects.toThrow('getHealth failed: 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps DAS on Helius URLs only', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response('nope', { status: 503 });
    });

    await expect(rpcJson('devnet', 'getAssetsByOwner', {}, {
      das: true,
      urls: [
        'https://devnet.helius-rpc.com/?api-key=test',
        PUBLIC_DEVNET_RPC,
      ],
    })).rejects.toThrow('getAssetsByOwner failed: 503');
    expect(requested).toEqual(['https://devnet.helius-rpc.com/?api-key=test']);
  });
});
