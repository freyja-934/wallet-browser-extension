import { Buffer } from 'buffer';

export interface EncryptedData {
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface EncryptionConfig {
  iterations: number;
}

const DEFAULT_CONFIG: EncryptionConfig = {
  iterations: 100000, // PBKDF2 iterations
};

/**
 * Derives a key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  config: EncryptionConfig = DEFAULT_CONFIG
): Promise<CryptoKey> {
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
      iterations: config.iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using PBKDF2 + AES-256-GCM
 */
export async function encrypt(
  data: Uint8Array | string,
  password: string
): Promise<EncryptedData> {
  // Convert string data to Uint8Array if needed
  const dataBytes = typeof data === 'string' 
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  
  // Generate random salt and nonce
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  
  // Derive key using PBKDF2
  const key = await deriveKey(password, salt);
  
  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    dataBytes
  );
  
  return {
    salt: Buffer.from(salt).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex')
  };
}

/**
 * Decrypts data encrypted with encrypt()
 */
export async function decrypt(
  encryptedData: EncryptedData,
  password: string
): Promise<Uint8Array> {
  // Parse hex strings back to buffers
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const nonce = Buffer.from(encryptedData.nonce, 'hex');
  const ciphertext = Buffer.from(encryptedData.ciphertext, 'hex');
  
  // Derive key using same parameters
  const key = await deriveKey(password, salt);
  
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
