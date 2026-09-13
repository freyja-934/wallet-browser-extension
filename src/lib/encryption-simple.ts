import { Buffer } from 'buffer';

/**
 * The KDF parameters a vault blob was written with. Stored inside the blob so
 * every ciphertext is self-describing and `decrypt` never guesses from a global
 * default: the only way to read a blob is with the parameters it carries.
 */
export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
}

export interface EncryptedData {
  /** Absent on blobs written before versioning; those are v1 (see `V1_KDF`). */
  version?: number;
  /** Present from v2 on; absent means `V1_KDF`. */
  kdf?: KdfParams;
  salt: string;
  nonce: string;
  ciphertext: string;
}

/** What `encrypt` writes today. */
export const CURRENT_VAULT_VERSION = 2;

/**
 * OWASP's PBKDF2-SHA256 figure. About 0.13 s per derivation on an Apple M1 Max;
 * see docs/adr/0002-vault-v2.md for the measurement and the migration.
 */
export const PBKDF2_ITERATIONS = 600_000;

/** v2 and everything after it: the parameters travel with the ciphertext. */
export const CURRENT_KDF: KdfParams = {
  name: 'PBKDF2',
  hash: 'SHA-256',
  iterations: PBKDF2_ITERATIONS,
};

/** Unversioned blobs, written before the format carried its parameters. */
export const V1_KDF: KdfParams = { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 };

/**
 * The parameters `data` was encrypted with. No `version` means v1; a versioned
 * blob must carry parameters this build understands, or it is not readable here.
 */
export function kdfFor(data: EncryptedData): KdfParams {
  if (data.version === undefined) return V1_KDF;
  const kdf = data.kdf;
  if (
    !kdf ||
    kdf.name !== 'PBKDF2' ||
    kdf.hash !== 'SHA-256' ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations <= 0
  ) {
    throw new Error('Unsupported vault format');
  }
  return kdf;
}

/**
 * Derives a key from password using PBKDF2 with the given parameters.
 */
async function deriveKey(password: string, salt: Uint8Array, kdf: KdfParams): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: kdf.iterations,
      hash: kdf.hash,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using PBKDF2 + AES-256-GCM, always in the current format.
 */
export async function encrypt(
  data: Uint8Array | string,
  password: string
): Promise<EncryptedData> {
  // Convert string data to Uint8Array if needed
  const dataBytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);

  // Fresh salt and nonce per encryption: AES-GCM never reuses a nonce with a key.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKey(password, salt, CURRENT_KDF);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    dataBytes
  );

  return {
    version: CURRENT_VAULT_VERSION,
    kdf: { ...CURRENT_KDF },
    salt: Buffer.from(salt).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex')
  };
}

/**
 * Decrypts data encrypted with encrypt(), reading the KDF parameters from the
 * blob itself so a vault written by an older build still opens.
 */
export async function decrypt(
  encryptedData: EncryptedData,
  password: string
): Promise<Uint8Array> {
  // Parse hex strings back to buffers
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const nonce = Buffer.from(encryptedData.nonce, 'hex');
  const ciphertext = Buffer.from(encryptedData.ciphertext, 'hex');

  const key = await deriveKey(password, salt, kdfFor(encryptedData));

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypts a string and returns encrypted string
 */
export async function encryptString(
  data: string,
  password: string
): Promise<string> {
  const encrypted = await encrypt(data, password);
  return JSON.stringify(encrypted);
}

/**
 * Decrypts a string encrypted with encryptString
 */
export async function decryptString(
  encryptedString: string,
  password: string
): Promise<string> {
  const encrypted = JSON.parse(encryptedString) as EncryptedData;
  const decrypted = await decrypt(encrypted, password);
  return new TextDecoder().decode(decrypted);
}

/**
 * Validates password strength
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  // Length check
  if (password.length >= 12) {
    score += 2;
  } else if (password.length >= 8) {
    score += 1;
    feedback.push('Password should be at least 12 characters long');
  } else {
    feedback.push('Password must be at least 8 characters long');
  }
  
  // Complexity checks
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Include lowercase letters');
  
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Include uppercase letters');
  
  if (/[0-9]/.test(password)) score += 1;
  else feedback.push('Include numbers');
  
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  else feedback.push('Include special characters');
  
  // Common patterns check
  if (!/(.)\1{2,}/.test(password)) score += 1;
  else feedback.push('Avoid repeating characters');
  
  return {
    isValid: password.length >= 8 && score >= 4,
    score: Math.min(score, 5),
    feedback
  };
}

/**
 * Clears sensitive data from memory
 */
export function clearMemory(data: Uint8Array): void {
  crypto.getRandomValues(data);
  data.fill(0);
}

/**
 * Generates a secure session key
 */
export async function generateSessionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}
