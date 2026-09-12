import { TOKEN_2022_PROGRAM_ID, getTokenMetadata } from '@solana/spl-token';
import { PublicKey, type Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';

/** Metaplex Token Metadata program. */
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/** `getMultipleAccountsInfo` accepts at most 100 keys per call. */
export const METADATA_BATCH = 100;

/** Metaplex `Key::MetadataV1`, the first byte of every metadata account. */
const METADATA_V1_KEY = 4;

/** Offset of the name string: key u8, then update authority (32) and mint (32). */
const METADATA_STRINGS_OFFSET = 1 + 64;

export interface TokenNames {
  name: string;
  symbol: string;
}

export interface DecodedMetadata extends TokenNames {
  uri: string;
}

/** A mint to look up; `programId` is base58 and decides whether Token-2022 metadata is tried first. */
export interface MintRef {
  mint: string;
  programId?: string;
}

/** Runs a `Connection` callback against whichever endpoint answers (see `withRotatedConnection`). */
export type ConnectionRunner = <T>(fn: (connection: Connection) => Promise<T>) => Promise<T>;

/** The Metaplex metadata PDA for `mint`. */
export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];
}

/**
 * Hand Borsh decode of a Metaplex metadata account: key u8, 64 bytes skipped
 * (update authority, mint), then three u32-LE length-prefixed strings (name,
 * symbol, uri) with their `\0` padding trimmed. Accounts were resized over the
 * years, so nothing here asserts a total length; a string cut short by the end
 * of the buffer is returned as far as it goes.
 */
export function decodeMetadata(data: Uint8Array): DecodedMetadata | undefined {
  if (data.length < METADATA_STRINGS_OFFSET + 4 || data[0] !== METADATA_V1_KEY) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = METADATA_STRINGS_OFFSET;
  const readString = (): string => {
    if (offset + 4 > data.length) return '';
    const length = view.getUint32(offset, true);
    offset += 4;
    const end = Math.min(offset + length, data.length);
    const text = decoder.decode(data.subarray(offset, end)).replace(/\0+$/, '');
    offset = end;
    return text;
  };
  const name = readString();
  const symbol = readString();
  const uri = readString();
  return { name, symbol, uri };
}

/**
 * Names for `mints` from chain data: Token-2022 mints try the metadata extension
 * (`getTokenMetadata`) first, then every mint still unnamed is looked up at its
 * Metaplex PDA in batches of `METADATA_BATCH`. Mints with no metadata are left
 * out of the map; a per-mint failure is not an error, a failed batch is.
 */
export async function fetchTokenMetadata(run: ConnectionRunner, mints: MintRef[]): Promise<Map<string, TokenNames>> {
  const names = new Map<string, TokenNames>();
  const remaining: PublicKey[] = [];
  const token2022 = TOKEN_2022_PROGRAM_ID.toBase58();

  for (const { mint, programId } of mints) {
    const key = new PublicKey(mint);
    if (programId === token2022) {
      try {
        const meta = await run((connection) => getTokenMetadata(connection, key, 'confirmed', TOKEN_2022_PROGRAM_ID));
        if (meta && (meta.name || meta.symbol)) {
          names.set(mint, { name: meta.name, symbol: meta.symbol });
          continue;
        }
      } catch {
        // No extension, or the mint could not be read: fall through to Metaplex.
      }
    }
    remaining.push(key);
  }

  for (let i = 0; i < remaining.length; i += METADATA_BATCH) {
    const chunk = remaining.slice(i, i + METADATA_BATCH);
    const accounts = await run((connection) => connection.getMultipleAccountsInfo(chunk.map(metadataPda)));
    accounts.forEach((account, index) => {
      if (!account || !account.owner.equals(METADATA_PROGRAM_ID)) return;
      const decoded = decodeMetadata(account.data);
      if (decoded && (decoded.name || decoded.symbol)) {
        names.set(chunk[index].toBase58(), { name: decoded.name, symbol: decoded.symbol });
      }
    });
  }

  return names;
}
