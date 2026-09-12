import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getTokenMetadata } from '@solana/spl-token';
import { PublicKey, type AccountInfo, type Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  METADATA_BATCH,
  METADATA_PROGRAM_ID,
  decodeMetadata,
  fetchTokenMetadata,
  metadataPda,
  type ConnectionRunner,
} from './token-metadata';

vi.mock('@solana/spl-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/spl-token')>();
  return { ...actual, getTokenMetadata: vi.fn() };
});

const mockedGetTokenMetadata = vi.mocked(getTokenMetadata);

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
/** The live Metaplex metadata account for USDC on mainnet. */
const USDC_METADATA = '5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq';

function u32(length: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(length, 0);
  return out;
}

/** A Borsh string: u32-LE length, then the bytes; `padTo` mirrors Metaplex's fixed-width padding with `\0`. */
function borshString(text: string, padTo?: number): Buffer {
  const body = Buffer.from(text, 'utf8');
  const padded = padTo === undefined ? body : Buffer.concat([body, Buffer.alloc(Math.max(0, padTo - body.length))]);
  return Buffer.concat([u32(padded.length), padded]);
}

function buildMetadata(
  fields: { name: string; symbol: string; uri: string },
  options: { key?: number; pad?: boolean; trailing?: number } = {},
): Uint8Array {
  const { key = 4, pad = false, trailing = 0 } = options;
  return Buffer.concat([
    Buffer.from([key]),
    Buffer.alloc(32, 1), // update authority
    Buffer.alloc(32, 2), // mint
    borshString(fields.name, pad ? 32 : undefined),
    borshString(fields.symbol, pad ? 10 : undefined),
    borshString(fields.uri, pad ? 200 : undefined),
    Buffer.alloc(trailing, 0xff), // seller fee, creators, collection, uses... never decoded here
  ]);
}

function account(data: Uint8Array, owner: PublicKey = METADATA_PROGRAM_ID): AccountInfo<Buffer> {
  return { executable: false, owner, lamports: 1, data: Buffer.from(data) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('metadataPda', () => {
  it('derives the Metaplex metadata account for a mint', () => {
    expect(metadataPda(USDC_MINT).toBase58()).toBe(USDC_METADATA);
  });
});

describe('decodeMetadata', () => {
  it('reads name, symbol and uri from a hand-built account', () => {
    const data = buildMetadata({ name: 'Wrapped SOL', symbol: 'wSOL', uri: 'https://example.com/wsol.json' });

    expect(decodeMetadata(data)).toEqual({ name: 'Wrapped SOL', symbol: 'wSOL', uri: 'https://example.com/wsol.json' });
  });

  it('trims the padding Metaplex writes and ignores whatever follows the strings', () => {
    const data = buildMetadata({ name: 'USD Coin', symbol: 'USDC', uri: '' }, { pad: true, trailing: 300 });

    expect(data.length).toBe(1 + 64 + 4 + 32 + 4 + 10 + 4 + 200 + 300);
    expect(decodeMetadata(data)).toEqual({ name: 'USD Coin', symbol: 'USDC', uri: '' });
  });

  it('returns what it can from a buffer cut short instead of asserting a length', () => {
    const full = buildMetadata({ name: 'Cinder', symbol: 'CNDR', uri: 'https://example.com/cndr.json' });
    const cutInsideUri = full.subarray(0, 1 + 64 + 4 + 6 + 4 + 4 + 4 + 5);
    const cutBeforeSymbol = full.subarray(0, 1 + 64 + 4 + 6);

    expect(decodeMetadata(cutInsideUri)).toEqual({ name: 'Cinder', symbol: 'CNDR', uri: 'https' });
    expect(decodeMetadata(cutBeforeSymbol)).toEqual({ name: 'Cinder', symbol: '', uri: '' });
  });

  it('rejects a buffer with no room for a name length or with another account key', () => {
    expect(decodeMetadata(new Uint8Array(1 + 64 + 3))).toBeUndefined();
    expect(decodeMetadata(buildMetadata({ name: 'x', symbol: 'x', uri: '' }, { key: 6 }))).toBeUndefined();
  });
});

describe('fetchTokenMetadata', () => {
  function fakeConnection(handler: (keys: PublicKey[]) => Array<AccountInfo<Buffer> | null>) {
    const calls: PublicKey[][] = [];
    const connection = {
      getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => {
        calls.push(keys);
        return handler(keys);
      }),
    } as unknown as Connection;
    const run: ConnectionRunner = (fn) => fn(connection);
    return { run, calls };
  }

  it('batches Metaplex lookups by 100 and names only the mints that have an account', async () => {
    const mints = Array.from({ length: METADATA_BATCH + 50 }, () => PublicKey.unique());
    const named = mints[0];
    const otherOwner = mints[1];
    const { run, calls } = fakeConnection((keys) =>
      keys.map((key) => {
        if (key.equals(metadataPda(named))) return account(buildMetadata({ name: 'Named', symbol: 'NMD', uri: '' }));
        if (key.equals(metadataPda(otherOwner))) {
          return account(buildMetadata({ name: 'Fake', symbol: 'FAKE', uri: '' }), PublicKey.unique());
        }
        return null;
      }),
    );

    const names = await fetchTokenMetadata(
      run,
      mints.map((mint) => ({ mint: mint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58() })),
    );

    expect(calls.map((keys) => keys.length)).toEqual([METADATA_BATCH, 50]);
    expect(calls[0][0].toBase58()).toBe(metadataPda(named).toBase58());
    expect([...names.entries()]).toEqual([[named.toBase58(), { name: 'Named', symbol: 'NMD' }]]);
    expect(mockedGetTokenMetadata).not.toHaveBeenCalled();
  });

  it('asks the Token-2022 metadata extension first and falls back to Metaplex when it has none', async () => {
    const withExtension = PublicKey.unique();
    const withoutExtension = PublicKey.unique();
    mockedGetTokenMetadata.mockImplementation(async (_connection, mint) => {
      if (mint.equals(withExtension)) {
        return { name: 'Ext Token', symbol: 'EXT', uri: '', mint, additionalMetadata: [] };
      }
      throw new Error('TokenAccountNotFoundError');
    });
    const { run, calls } = fakeConnection((keys) =>
      keys.map((key) =>
        key.equals(metadataPda(withoutExtension))
          ? account(buildMetadata({ name: 'Legacy', symbol: 'LGCY', uri: '' }))
          : null,
      ),
    );

    const names = await fetchTokenMetadata(run, [
      { mint: withExtension.toBase58(), programId: TOKEN_2022_PROGRAM_ID.toBase58() },
      { mint: withoutExtension.toBase58(), programId: TOKEN_2022_PROGRAM_ID.toBase58() },
    ]);

    expect(mockedGetTokenMetadata).toHaveBeenCalledTimes(2);
    expect(mockedGetTokenMetadata.mock.calls[0][3]).toBe(TOKEN_2022_PROGRAM_ID);
    // Only the mint the extension could not name reaches the Metaplex batch.
    expect(calls).toEqual([[metadataPda(withoutExtension)]]);
    expect(names.get(withExtension.toBase58())).toEqual({ name: 'Ext Token', symbol: 'EXT' });
    expect(names.get(withoutExtension.toBase58())).toEqual({ name: 'Legacy', symbol: 'LGCY' });
  });

  it('skips the batch when nothing is left to look up', async () => {
    const { run, calls } = fakeConnection(() => []);

    await expect(fetchTokenMetadata(run, [])).resolves.toEqual(new Map());

    expect(calls).toEqual([]);
  });
});
