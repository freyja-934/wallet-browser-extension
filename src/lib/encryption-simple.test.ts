import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './encryption-simple';

describe('encryption', () => {
  it('round-trips a mnemonic', async () => {
    const secret = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const encrypted = await encrypt(secret, 'correct-horse-battery');
    const plain = await decrypt(encrypted, 'correct-horse-battery');
    expect(new TextDecoder().decode(plain)).toBe(secret);
  });

  it('fails on the wrong password', async () => {
    const encrypted = await encrypt('secret', 'right-password');
    await expect(decrypt(encrypted, 'wrong-password')).rejects.toThrow();
  });
});
