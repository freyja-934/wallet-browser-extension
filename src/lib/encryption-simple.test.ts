import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_KDF,
  CURRENT_VAULT_VERSION,
  decrypt,
  encrypt,
  kdfFor,
  V1_KDF,
  validatePasswordStrength,
  type EncryptedData,
} from './encryption-simple';

const SECRET = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** A blob in the pre-versioning format: no `version`, no `kdf`, 100k iterations. */
async function encryptV1(data: string, password: string): Promise<EncryptedData> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: V1_KDF.iterations, hash: V1_KDF.hash },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(data),
  );
  return {
    salt: Buffer.from(salt).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex'),
  };
}

describe('encryption', () => {
  it('round-trips a mnemonic', async () => {
    const encrypted = await encrypt(SECRET, 'correct-horse-battery');
    const plain = await decrypt(encrypted, 'correct-horse-battery');
    expect(new TextDecoder().decode(plain)).toBe(SECRET);
  });

  it('fails on the wrong password', async () => {
    const encrypted = await encrypt('secret', 'right-password');
    await expect(decrypt(encrypted, 'wrong-password')).rejects.toThrow();
  });

  it('writes the current version and its KDF parameters into the blob', async () => {
    const encrypted = await encrypt(SECRET, 'password');
    expect(encrypted.version).toBe(CURRENT_VAULT_VERSION);
    expect(encrypted.kdf).toEqual(CURRENT_KDF);
    expect(CURRENT_KDF.iterations).toBe(600_000);
  });

  it('uses a fresh salt and nonce for the same data under the same password', async () => {
    const first = await encrypt(SECRET, 'password');
    const second = await encrypt(SECRET, 'password');
    expect(second.salt).not.toBe(first.salt);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('reads a v1 blob with the v1 parameters, not the current ones', async () => {
    const legacy = await encryptV1(SECRET, 'password');
    expect(kdfFor(legacy)).toEqual(V1_KDF);
    expect(new TextDecoder().decode(await decrypt(legacy, 'password'))).toBe(SECRET);

    // The same bytes read as if they were current would derive a different key and fail.
    const mislabelled: EncryptedData = { ...legacy, version: 2, kdf: CURRENT_KDF };
    await expect(decrypt(mislabelled, 'password')).rejects.toThrow();
  });

  it('fails on a tampered ciphertext', async () => {
    const encrypted = await encrypt(SECRET, 'password');
    const bytes = Buffer.from(encrypted.ciphertext, 'hex');
    bytes[0] ^= 0xff;
    await expect(decrypt({ ...encrypted, ciphertext: bytes.toString('hex') }, 'password')).rejects.toThrow();
  });

  it('refuses a versioned blob whose KDF this build does not understand', () => {
    expect(() => kdfFor({ version: 3, salt: '', nonce: '', ciphertext: '' })).toThrow('Unsupported vault format');
    // A newer version whose parameters happen to look familiar is still a format
    // this build cannot read: refuse it rather than derive with them and report
    // the failure as a wrong password.
    expect(() => kdfFor({ version: 3, kdf: CURRENT_KDF, salt: '', nonce: '', ciphertext: '' })).toThrow(
      'Unsupported vault format',
    );
    expect(() => kdfFor({ version: 2.5, kdf: CURRENT_KDF, salt: '', nonce: '', ciphertext: '' })).toThrow(
      'Unsupported vault format',
    );
    expect(() =>
      kdfFor({ version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 0 }, salt: '', nonce: '', ciphertext: '' }),
    ).toThrow('Unsupported vault format');
  });
});

describe('validatePasswordStrength', () => {
  it('accepts the fixture password and rejects a short one', () => {
    expect(validatePasswordStrength('TestWallet1!').isValid).toBe(true);
    const weak = validatePasswordStrength('short');
    expect(weak.isValid).toBe(false);
    expect(weak.feedback[0]).toMatch(/at least 8 characters/);
  });
});
