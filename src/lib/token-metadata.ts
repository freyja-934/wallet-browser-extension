import { TOKEN_2022_PROGRAM_ID, getTokenMetadata } from '@solana/spl-token';
import { PublicKey, type Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { COOLDOWN_RPC_MESSAGE, SKIP_RPC_MESSAGE, connectionErrorHttpStatus, isTransportError } from './rpc-rotate';

/** Metaplex Token Metadata program. */
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/** `getMultipleAccountsInfo` accepts at most 100 keys per call. */
export const METADATA_BATCH = 100;

/** Token-2022 extension lookups in flight at once; each one is a `getAccountInfo` of the mint. */
export const TOKEN_2022_CONCURRENCY = 4;

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
 * Did the endpoint fail (HTTP status, JSON-RPC code, transport, node-health text)?
 * Anything else thrown inside a lookup, such as spl-token's `TokenAccountNotFoundError`
 * (an empty message) for a mint without the extension, or a decode error on odd
 * account data, is about that one mint and must never reach the rotation layer,
 * which would read it as endpoint trouble and cool the URL down.
 */
function isEndpointFailure(error: unknown): boolean {
  if (isTransportError(error)) return true;
  if (connectionErrorHttpStatus(error) !== undefined) return true;
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'number' && Number.isInteger(code) && code < 0) return true;
  const message = error instanceof Error ? error.message : String(error);
  return SKIP_RPC_MESSAGE.test(message) || COOLDOWN_RPC_MESSAGE.test(message);
}

/** The Token-2022 metadata extension for one mint, or undefined when the mint has none. */
async function token2022Names(run: ConnectionRunner, mint: PublicKey): Promise<TokenNames | undefined> {
  const meta = await run(async (connection) => {
    try {
      return await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    } catch (error) {
      if (isEndpointFailure(error)) throw error;
      return null;
    }
  });
  return meta && (meta.name || meta.symbol) ? { name: meta.name, symbol: meta.symbol } : undefined;
}

/**
 * Names for `mints` from chain data: Token-2022 mints try the metadata extension
 * (`getTokenMetadata`) first, `TOKEN_2022_CONCURRENCY` at a time and each
 * settled on its own, then every mint still unnamed is looked up at its Metaplex
 * PDA in batches of `METADATA_BATCH`. Mints with no metadata are left out of the
 * map; a per-mint failure is not an error, a failed Metaplex batch is.
 */
export async function fetchTokenMetadata(run: ConnectionRunner, mints: MintRef[]): Promise<Map<string, TokenNames>> {
  const names = new Map<string, TokenNames>();
  const token2022 = TOKEN_2022_PROGRAM_ID.toBase58();

  const extensionMints = mints.filter(({ programId }) => programId === token2022);
  for (let i = 0; i < extensionMints.length; i += TOKEN_2022_CONCURRENCY) {
    const chunk = extensionMints.slice(i, i + TOKEN_2022_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(({ mint }) => token2022Names(run, new PublicKey(mint))));
    settled.forEach((result, index) => {
      // A rejected lookup means every endpoint failed for this mint; it falls through to Metaplex.
      if (result.status === 'fulfilled' && result.value) names.set(chunk[index].mint, result.value);
    });
  }

  const remaining = mints.filter(({ mint }) => !names.has(mint)).map(({ mint }) => new PublicKey(mint));
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
