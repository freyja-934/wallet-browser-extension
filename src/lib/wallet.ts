import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import type { WalletAccountInfo } from './messages';

const SOLANA_COIN_TYPE = 501;
const PURPOSE = 44;

export interface SeedPhraseInfo {
  mnemonic: string;
  seed: Buffer;
  isValid: boolean;
  wordCount: number;
}

/** BIP39 seed via WebCrypto so the MV3 service worker never hits Node `pbkdf2` / `stream`. */
export async function mnemonicToSeedBuffer(mnemonic: string, passphrase = ''): Promise<Buffer> {
  const enc = new TextEncoder();
  const password = enc.encode(mnemonic.normalize('NFKD'));
  const salt = enc.encode(`mnemonic${passphrase.normalize('NFKD')}`);
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 2048, hash: 'SHA-512' },
    key,
    512
  );
  return Buffer.from(bits);
}

export function generateSeedPhrase(wordCount: 12 | 24 = 12): SeedPhraseInfo {
  const strength = wordCount === 12 ? 128 : 256;
  const mnemonic = bip39.generateMnemonic(strength);

  return {
    mnemonic,
    seed: Buffer.alloc(0),
    isValid: true,
    wordCount
  };
}

export function validateSeedPhrase(mnemonic: string): SeedPhraseInfo {
  const isValid = bip39.validateMnemonic(mnemonic);
  const words = mnemonic.trim().split(/\s+/);
  const wordCount = words.length as 12 | 24;

  return {
    mnemonic,
    seed: Buffer.alloc(0),
    isValid,
    wordCount
  };
}

const HARDENED = 0x80000000;

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new Uint8Array(data)));
}

async function slip10Derive(seed: Buffer, path: string): Promise<Uint8Array> {
  const segments = path
    .replace(/^m\//, '')
    .split('/')
    .map((part) => {
      const hardened = part.endsWith("'");
      const index = parseInt(hardened ? part.slice(0, -1) : part, 10);
      return (hardened ? index + HARDENED : index) >>> 0;
    });

  let I = await hmacSha512(new TextEncoder().encode('ed25519 seed'), new Uint8Array(seed));
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);

  for (const index of segments) {
    const data = new Uint8Array(1 + 32 + 4);
    data.set(key, 1);
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;
    I = await hmacSha512(chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }

  return key;
}

/**
 * Derives a keypair from a BIP39 seed (64 bytes), not from the mnemonic string.
 * Path: m/44'/501'/account'/change'
 */
export async function deriveKeypairFromSeed(
  seed: Buffer,
  accountIndex: number = 0,
  change: number = 0
): Promise<{ keypair: Keypair; derivationPath: string }> {
  const derivationPath = `m/${PURPOSE}'/${SOLANA_COIN_TYPE}'/${accountIndex}'/${change}'`;
  const derivedSeed = await slip10Derive(seed, derivationPath);
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    keypair,
    derivationPath
  };
}

export async function generateAccountsFromSeed(
  seed: Buffer,
  count: number = 1,
  startIndex: number = 0
): Promise<WalletAccountInfo[]> {
  const accounts: WalletAccountInfo[] = [];

  for (let i = 0; i < count; i++) {
    const accountIndex = startIndex + i;
    const { keypair, derivationPath } = await deriveKeypairFromSeed(seed, accountIndex);

    accounts.push({
      address: keypair.publicKey.toBase58(),
      name: `Account ${accountIndex + 1}`,
      derivationPath,
      index: accountIndex
    });
  }

  return accounts;
}

export function isValidWord(word: string): boolean {
  return bip39.wordlists.english.includes(word.toLowerCase());
}

export function getWordSuggestions(prefix: string, limit: number = 5): string[] {
  if (!prefix) return [];

  const lowerPrefix = prefix.toLowerCase();
  return bip39.wordlists.english
    .filter(word => word.startsWith(lowerPrefix))
    .slice(0, limit);
}
