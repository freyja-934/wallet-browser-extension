import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { signBytes, verifyBytes } from './sign';

describe('signBytes', () => {
  it('creates a verifiable ed25519 signature and does not return the secret key', () => {
    const keypair = Keypair.generate();
    const message = new TextEncoder().encode('hello cinder');
    const signature = signBytes(message, keypair.secretKey);
    expect(signature.length).toBe(64);
    expect(Buffer.from(signature).equals(Buffer.from(keypair.secretKey.slice(0, 64)))).toBe(false);
    expect(verifyBytes(message, signature, keypair.publicKey.toBytes())).toBe(true);
  });
});
