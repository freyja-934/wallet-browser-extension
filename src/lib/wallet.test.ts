import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import { generateAccountsFromSeed, mnemonicToSeedBuffer, validateSeedPhrase } from './wallet';

const fixture = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('wallet derivation', () => {
  it('rejects treating the mnemonic string as seed bytes', async () => {
    const seed = await mnemonicToSeedBuffer(fixture);
    expect(seed.length).toBe(64);
    expect(Buffer.from(fixture).equals(seed)).toBe(false);
  });

  it('derives a stable first account from a known mnemonic', async () => {
    const info = validateSeedPhrase(fixture);
    expect(info.isValid).toBe(true);
    const seed = await mnemonicToSeedBuffer(fixture);
    const [account] = await generateAccountsFromSeed(seed, 1);
    expect(account.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(account.derivationPath).toBe("m/44'/501'/0'/0'");
    const slip = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    expect(account.address).toBe(Keypair.fromSeed(slip.key).publicKey.toBase58());
  });
});
