import { Keypair, PublicKey } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { derivePath } from 'ed25519-hd-key';

// BIP44 constants for Solana
const SOLANA_COIN_TYPE = 501;
const PURPOSE = 44;

export interface WalletAccount {
  address: string;
  publicKey: PublicKey;
  name: string;
  derivationPath: string;
  index: number;
}

export interface SeedPhraseInfo {
  mnemonic: string;
  seed: Buffer;
  isValid: boolean;
  wordCount: number;
}

/**
 * Generates a new seed phrase with specified word count
 */
export function generateSeedPhrase(wordCount: 12 | 24 = 12): SeedPhraseInfo {
  const strength = wordCount === 12 ? 128 : 256;
  const mnemonic = bip39.generateMnemonic(strength);
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  
  return {
    mnemonic,
    seed,
    isValid: true,
    wordCount
  };
}

/**
 * Validates a seed phrase
 */
export function validateSeedPhrase(mnemonic: string): SeedPhraseInfo {
  const isValid = bip39.validateMnemonic(mnemonic);
  const words = mnemonic.trim().split(/\s+/);
  const wordCount = words.length as 12 | 24;
  
  if (!isValid) {
    return {
      mnemonic,
      seed: Buffer.alloc(0),
      isValid: false,
      wordCount
    };
  }
  
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  
  return {
    mnemonic,
    seed,
    isValid: true,
    wordCount
  };
}

/**
 * Derives a keypair from seed using BIP44 path
 * Path format: m/44'/501'/account'/change'
 */
export function deriveKeypairFromSeed(
  seed: Buffer,
  accountIndex: number = 0,
  change: number = 0
): { keypair: Keypair; derivationPath: string } {
  const derivationPath = `m/${PURPOSE}'/${SOLANA_COIN_TYPE}'/${accountIndex}'/${change}'`;
  
  // Derive the seed for this path
  const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
  const keypair = Keypair.fromSeed(derivedSeed);
  
  return {
    keypair,
    derivationPath
  };
}

/**
 * Generates multiple accounts from a seed phrase
 */
export function generateAccountsFromSeed(
  seed: Buffer,
  count: number = 1,
  startIndex: number = 0
): WalletAccount[] {
  const accounts: WalletAccount[] = [];
  
  for (let i = 0; i < count; i++) {
    const accountIndex = startIndex + i;
    const { keypair, derivationPath } = deriveKeypairFromSeed(seed, accountIndex);
    
    accounts.push({
      address: keypair.publicKey.toBase58(),
      publicKey: keypair.publicKey,
      name: `Account ${accountIndex + 1}`,
      derivationPath,
      index: accountIndex
    });
  }
  
  return accounts;
}

/**
 * Creates a keypair from a private key (for importing)
 */
export function keypairFromPrivateKey(privateKey: string | Uint8Array): Keypair {
  if (typeof privateKey === 'string') {
    // Handle comma-separated format
    if (privateKey.includes(',')) {
      const bytes = privateKey.split(',').map(s => parseInt(s.trim(), 10));
      return Keypair.fromSecretKey(new Uint8Array(bytes));
    }
    
    // Handle base58 format
    try {
      const decoded = Buffer.from(privateKey, 'base64');
      return Keypair.fromSecretKey(new Uint8Array(decoded));
    } catch {
      // Try hex format
      const decoded = Buffer.from(privateKey, 'hex');
      return Keypair.fromSecretKey(new Uint8Array(decoded));
    }
  }
  
  return Keypair.fromSecretKey(privateKey);
}

/**
 * Gets the word list for seed phrase generation
 */
export function getWordList(): string[] {
  return bip39.wordlists.english;
}

/**
 * Checks if a word is valid in the BIP39 word list
 */
export function isValidWord(word: string): boolean {
  return bip39.wordlists.english.includes(word.toLowerCase());
}

/**
 * Gets word suggestions for autocomplete
 */
export function getWordSuggestions(prefix: string, limit: number = 5): string[] {
  if (!prefix) return [];
  
  const lowerPrefix = prefix.toLowerCase();
  return bip39.wordlists.english
    .filter(word => word.startsWith(lowerPrefix))
    .slice(0, limit);
}
