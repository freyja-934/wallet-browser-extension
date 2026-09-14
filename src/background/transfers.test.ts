import {
  ACCOUNT_SIZE,
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, Transaction, type AccountInfo, type Connection, type Message } from '@solana/web3.js';
import bs58 from 'bs58';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SendError } from '../lib/protocol';
import { installChromeStub, uninstallChromeStub } from '../test/chrome-stub';

/**
 * The only door to an endpoint: `getConnection` resolves every RPC through
 * `readyConnection`, so a spy here is how "never reached an endpoint" is
 * checked. Every other test in this file passes its own `io`, which never
 * reaches this.
 */
const rotate = vi.hoisted(() => ({
  readyConnection: vi.fn(async () => {
    throw new Error('no endpoint under test');
  }),
}));
vi.mock('../lib/rpc-rotate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rpc-rotate')>()),
  readyConnection: rotate.readyConnection,
}));
import {
  CONFIRM_POLL_MS,
  CONFIRM_TIMEOUT_MS,
  EXPIRED_MESSAGE,
  estimateTransfer,
  FALLBACK_FEE_LAMPORTS,
  sendTransfer,
  TIMED_OUT_MESSAGE,
  type TransferIo,
} from './transfers';

const SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const RENT = 890_880;
/** What a 165-byte token account costs; the figure a token send has to fund, not the bare-account one. */
const TOKEN_RENT = 2_039_280;
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const LAST_VALID = 100;

type Rpc = Pick<
  Connection,
  | 'getLatestBlockhash'
  | 'getFeeForMessage'
  | 'getMinimumBalanceForRentExemption'
  | 'getAccountInfo'
  | 'getBalance'
  | 'sendRawTransaction'
  | 'getSignatureStatuses'
  | 'getBlockHeight'
>;

type Status = { err: unknown; confirmationStatus?: 'processed' | 'confirmed' | 'finalized' } | null;

/** A Connection that answers from memory: a healthy chain where everything confirms at once. */
/** `never[]` parameters accept any override signature without `any`: nothing here calls an override through this type. */
function fakeRpc(overrides: Partial<Record<keyof Rpc, (...args: never[]) => Promise<unknown>>> = {}) {
  const base = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: LAST_VALID })),
    getFeeForMessage: vi.fn(async (_message: Message) => ({ context: { slot: 1 }, value: 5000 as number | null })),
    getMinimumBalanceForRentExemption: vi.fn(async (size: number) => (size === 0 ? RENT : TOKEN_RENT)),
    getAccountInfo: vi.fn(async (): Promise<AccountInfo<Buffer> | null> => null),
    getBalance: vi.fn(async () => 1_000_000_000),
    sendRawTransaction: vi.fn(async (_bytes: Uint8Array, _options?: unknown) => SIGNATURE),
    getSignatureStatuses: vi.fn(async () => ({
      context: { slot: 1 },
      value: [{ err: null, confirmationStatus: 'confirmed' }] as Status[],
    })),
    getBlockHeight: vi.fn(async () => 50),
  };
  return Object.assign(base, overrides);
}

function io(rpc: ReturnType<typeof fakeRpc>, signer = Keypair.generate()): TransferIo {
  return { connection: rpc as unknown as Connection, signer };
}

function account(owner: PublicKey, data = Buffer.alloc(0)): AccountInfo<Buffer> {
  return { owner, data, lamports: RENT, executable: false, rentEpoch: 0 };
}

function mintAccount(programId: PublicKey, decimals: number): AccountInfo<Buffer> {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return account(programId, data);
}

/** An initialized token account of `mint`, owned by `owner`, under `programId`. */
function tokenAccount(programId: PublicKey, mint: PublicKey, owner: PublicKey, amount = 1_000_000n): AccountInfo<Buffer> {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: 0n,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return account(programId, data);
}

/** A chain that answers from a table of addresses and says "no account" for anything else. */
function chainOf(entries: Array<[PublicKey, AccountInfo<Buffer>]>) {
  return vi.fn(async (address: PublicKey): Promise<AccountInfo<Buffer> | null> => {
    for (const [key, info] of entries) if (address.equals(key)) return info;
    return null;
  });
}

/**
 * `getAccountInfo` that knows the mint and, when `owner` is given, that owner's
 * associated token account of it — the account a send with no explicit `source`
 * spends from, and which `buildTransfer` reads before it builds a transfer on it.
 * Anything else is "no account".
 */
function chainWithMint(mint: PublicKey, programId: PublicKey, decimals: number, owner?: PublicKey) {
  const entries: Array<[PublicKey, AccountInfo<Buffer>]> = [[mint, mintAccount(programId, decimals)]];
  if (owner) {
    entries.push([
      getAssociatedTokenAddressSync(mint, owner, true, programId),
      tokenAccount(programId, mint, owner),
    ]);
  }
  return chainOf(entries);
}

/** The transaction the fake RPC was asked to broadcast. */
function broadcast(rpc: ReturnType<typeof fakeRpc>): Transaction {
  const [bytes] = rpc.sendRawTransaction.mock.calls[0];
  return Transaction.from(bytes);
}

const recipient = Keypair.generate().publicKey;
const sol = (amount: string) => ({ to: recipient.toBase58(), amountSmallest: amount });

describe('estimateTransfer', () => {
  it('prices the message the send would broadcast, with the rent minimum and recipient facts', async () => {
    const rpc = fakeRpc({ getFeeForMessage: vi.fn(async (_message: Message) => ({ context: { slot: 1 }, value: 10_000 })) });
    const signer = Keypair.generate();
    const estimate = await estimateTransfer(sol('1000'), io(rpc, signer));
    expect(estimate).toEqual({
      feeLamports: '10000',
      rentExemptMin: String(RENT),
      recipient: { exists: false, walletExists: false, isTokenAccount: false, offCurve: false },
    });
    // The fee lookup got a compiled message for a transfer from the signer.
    const [message] = rpc.getFeeForMessage.mock.calls[0];
    expect(message.staticAccountKeys[0].equals(signer.publicKey)).toBe(true);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });

  it('falls back to 5000 lamports when the RPC returns null or throws', async () => {
    const nullFee = fakeRpc({ getFeeForMessage: vi.fn(async () => ({ context: { slot: 1 }, value: null })) });
    expect((await estimateTransfer(sol('1000'), io(nullFee))).feeLamports).toBe(FALLBACK_FEE_LAMPORTS.toString());
    const throwing = fakeRpc({
      getFeeForMessage: vi.fn(async () => {
        throw new Error('Method not found');
      }),
    });
    expect((await estimateTransfer(sol('1000'), io(throwing))).feeLamports).toBe('5000');
  });

  it('reports an existing wallet, a token account, and an off-curve address', async () => {
    const wallet = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    expect((await estimateTransfer(sol('1'), io(wallet))).recipient).toEqual({
      exists: true,
      walletExists: true,
      isTokenAccount: false,
      offCurve: false,
    });

    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const isToken = fakeRpc({ getAccountInfo: vi.fn(async () => account(program)) });
      expect((await estimateTransfer(sol('1'), io(isToken))).recipient).toEqual({
        exists: true,
        walletExists: true,
        isTokenAccount: true,
        offCurve: false,
      });
    }

    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('cinder')], TOKEN_PROGRAM_ID);
    const rpc = fakeRpc();
    expect((await estimateTransfer({ to: pda.toBase58(), amountSmallest: '1' }, io(rpc))).recipient).toEqual({
      exists: false,
      walletExists: false,
      isTokenAccount: false,
      offCurve: true,
    });
  });

  it('refuses a recipient that is not a public key', async () => {
    await expect(estimateTransfer({ to: 'not-an-address', amountSmallest: '1' }, io(fakeRpc()))).rejects.toThrow(
      'Invalid recipient address',
    );
  });
});

describe('sendTransfer (SOL)', () => {
  it('signs a system transfer with the fetched blockhash and returns the signature once confirmed', async () => {
    const rpc = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    const signer = Keypair.generate();
    await expect(sendTransfer(sol('1000'), io(rpc, signer))).resolves.toBe(SIGNATURE);
    const tx = broadcast(rpc);
    expect(tx.recentBlockhash).toBe(BLOCKHASH);
    expect(tx.feePayer?.equals(signer.publicKey)).toBe(true);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(tx.verifySignatures()).toBe(true);
    expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: false, preflightCommitment: 'confirmed' });
  });

  it('refuses to leave the sender with less than the rent minimum but more than nothing', async () => {
    // 1 SOL - 0.9995 SOL - fee leaves 495000 lamports: above zero, below rent.
    const rpc = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    await expect(sendTransfer(sol('999500000'), io(rpc))).rejects.toThrow('Leave at least 0.00089088 SOL or send Max');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    // A SOL send may have to create a bare system account, so that is the rent it prices.
    expect(rpc.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(0);
  });

  it('refuses one lamport below the rent minimum and allows exactly it', async () => {
    const remainder = (left: number) => sol(String(1_000_000_000 - 5000 - left));
    const under = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    await expect(sendTransfer(remainder(RENT - 1), io(under))).rejects.toThrow('Leave at least 0.00089088 SOL or send Max');
    expect(under.sendRawTransaction).not.toHaveBeenCalled();
    const exact = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    await expect(sendTransfer(remainder(RENT), io(exact))).resolves.toBe(SIGNATURE);
  });

  it('allows emptying the account exactly (Max) and leaving at least the minimum', async () => {
    const exists = () => vi.fn(async () => account(SystemProgram.programId));
    const max = fakeRpc({ getAccountInfo: exists() });
    await expect(sendTransfer(sol(String(1_000_000_000 - 5000)), io(max))).resolves.toBe(SIGNATURE);
    const keepsRent = fakeRpc({ getAccountInfo: exists() });
    await expect(sendTransfer(sol(String(1_000_000_000 - 5000 - RENT)), io(keepsRent))).resolves.toBe(SIGNATURE);
  });

  it('refuses an amount the balance cannot cover with the fee', async () => {
    const rpc = fakeRpc({ getAccountInfo: vi.fn(async () => account(SystemProgram.programId)) });
    await expect(sendTransfer(sol('1000000000'), io(rpc))).rejects.toThrow('Insufficient balance');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('refuses to create a recipient with less than the rent minimum, and allows it with the minimum', async () => {
    const tooSmall = fakeRpc();
    await expect(sendTransfer(sol(String(RENT - 1)), io(tooSmall))).rejects.toThrow('New accounts need at least 0.00089088 SOL');
    expect(tooSmall.sendRawTransaction).not.toHaveBeenCalled();
    const enough = fakeRpc();
    await expect(sendTransfer(sol(String(RENT)), io(enough))).resolves.toBe(SIGNATURE);
  });

  it('uses the fallback fee in the rent guard when the RPC cannot price the message', async () => {
    // A live RPC answers or fails; the `value: null` branch is a type guard, so the
    // case worth proving here is the one a rotating endpoint actually produces.
    const rpc = fakeRpc({
      getFeeForMessage: vi.fn(async () => {
        throw new Error('failed to get fee for message');
      }),
      getAccountInfo: vi.fn(async () => account(SystemProgram.programId)),
    });
    // Exactly balance - 5000 empties the account under the fallback fee.
    await expect(sendTransfer(sol(String(1_000_000_000 - 5000)), io(rpc))).resolves.toBe(SIGNATURE);
  });

  it('reports a broadcast failure with the RPC text', async () => {
    const rpc = fakeRpc({
      getAccountInfo: vi.fn(async () => account(SystemProgram.programId)),
      sendRawTransaction: vi.fn(async () => {
        throw new Error('Transaction simulation failed: Blockhash not found');
      }),
    });
    await expect(sendTransfer(sol('1000'), io(rpc))).rejects.toThrow('Blockhash not found');
  });
});

describe('sendTransfer (SPL)', () => {
  const mint = Keypair.generate().publicKey;
  const spl = (amount: string) => ({ to: recipient.toBase58(), amountSmallest: amount, mint: mint.toBase58() });

  it('creates the recipient ATA idempotently and moves the amount with a checked transfer', async () => {
    const signer = Keypair.generate();
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 6, signer.publicKey) });
    await expect(sendTransfer(spl('1500000'), io(rpc, signer))).resolves.toBe(SIGNATURE);
    const [create, transfer] = broadcast(rpc).instructions;
    expect(broadcast(rpc).instructions).toHaveLength(2);

    const source = getAssociatedTokenAddressSync(mint, signer.publicKey, true, TOKEN_PROGRAM_ID);
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_PROGRAM_ID);
    expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    // CreateIdempotent is discriminator 1; plain Create is an empty payload.
    expect([...create.data]).toEqual([1]);
    expect(create.keys[0].pubkey.equals(signer.publicKey)).toBe(true);
    expect(create.keys[1].pubkey.equals(destination)).toBe(true);
    expect(create.keys[2].pubkey.equals(recipient)).toBe(true);
    expect(create.keys[3].pubkey.equals(mint)).toBe(true);
    expect(create.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);

    expect(transfer.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(transfer.data[0]).toBe(12);
    const decoded = decodeTransferCheckedInstruction(transfer, TOKEN_PROGRAM_ID);
    expect(decoded.data.amount).toBe(1_500_000n);
    expect(decoded.data.decimals).toBe(6);
    expect(decoded.keys.source.pubkey.equals(source)).toBe(true);
    expect(decoded.keys.destination.pubkey.equals(destination)).toBe(true);
    expect(decoded.keys.owner.pubkey.equals(signer.publicKey)).toBe(true);
    // No SOL rent guard on a token send.
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });

  it('threads Token-2022 through the ATA derivation, the create, and the transfer', async () => {
    const signer = Keypair.generate();
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_2022_PROGRAM_ID, 9, signer.publicKey) });
    await sendTransfer(spl('7'), io(rpc, signer));
    const [create, transfer] = broadcast(rpc).instructions;
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_2022_PROGRAM_ID);
    expect(destination.equals(getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_PROGRAM_ID))).toBe(false);
    expect(create.keys[1].pubkey.equals(destination)).toBe(true);
    expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(transfer.data[0]).toBe(12);
    const decoded = decodeTransferCheckedInstruction(transfer, TOKEN_2022_PROGRAM_ID);
    expect(decoded.data.decimals).toBe(9);
    expect(decoded.data.amount).toBe(7n);
    // The signer's own ATA is program-specific too: the classic derivation would spend nothing.
    const source = getAssociatedTokenAddressSync(mint, signer.publicKey, true, TOKEN_2022_PROGRAM_ID);
    expect(source.equals(getAssociatedTokenAddressSync(mint, signer.publicKey, true, TOKEN_PROGRAM_ID))).toBe(false);
    expect(decoded.keys.source.pubkey.equals(source)).toBe(true);
  });

  it('sends to an off-curve owner, deriving its ATA', async () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], SystemProgram.programId);
    const signer = Keypair.generate();
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 0, signer.publicKey) });
    await sendTransfer({ to: pda.toBase58(), amountSmallest: '1', mint: mint.toBase58() }, io(rpc, signer));
    const [create] = broadcast(rpc).instructions;
    expect(create.keys[1].pubkey.equals(getAssociatedTokenAddressSync(mint, pda, true, TOKEN_PROGRAM_ID))).toBe(true);
  });

  it('refuses a mint owned by neither token program, or missing', async () => {
    const wrongOwner = fakeRpc({ getAccountInfo: chainWithMint(mint, SystemProgram.programId, 6) });
    await expect(sendTransfer(spl('1'), io(wrongOwner))).rejects.toThrow('Unknown token program');
    const missing = fakeRpc();
    await expect(sendTransfer(spl('1'), io(missing))).rejects.toThrow('Mint not found');
    await expect(estimateTransfer(spl('1'), io(missing))).rejects.toThrow('Mint not found');
  });

  it('prices a token send from the same two-instruction message', async () => {
    const signer = Keypair.generate();
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 6, signer.publicKey) });
    const estimate = await estimateTransfer(spl('1'), io(rpc, signer));
    expect(estimate.feeLamports).toBe('5000');
    const [message] = rpc.getFeeForMessage.mock.calls[0];
    expect(message.compiledInstructions).toHaveLength(2);
  });

  it('spends the token account it was given, even when that is not the ATA', async () => {
    const signer = Keypair.generate();
    // A wallet can hold several accounts of one mint; only one of them is the ATA.
    const source = Keypair.generate().publicKey;
    expect(source.equals(getAssociatedTokenAddressSync(mint, signer.publicKey, true, TOKEN_PROGRAM_ID))).toBe(false);
    const rpc = fakeRpc({
      getAccountInfo: chainOf([
        [mint, mintAccount(TOKEN_PROGRAM_ID, 6)],
        [source, tokenAccount(TOKEN_PROGRAM_ID, mint, signer.publicKey)],
      ]),
    });

    await expect(sendTransfer({ ...spl('5'), source: source.toBase58() }, io(rpc, signer))).resolves.toBe(SIGNATURE);
    const [, transfer] = broadcast(rpc).instructions;
    const decoded = decodeTransferCheckedInstruction(transfer, TOKEN_PROGRAM_ID);
    expect(decoded.keys.source.pubkey.equals(source)).toBe(true);
    expect(decoded.data.amount).toBe(5n);
  });

  it('refuses a source that is not the signer\'s account of this mint', async () => {
    const signer = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const otherMint = Keypair.generate().publicKey;
    const cases = [
      ['owned by someone else', tokenAccount(TOKEN_PROGRAM_ID, mint, Keypair.generate().publicKey)],
      ['holding another mint', tokenAccount(TOKEN_PROGRAM_ID, otherMint, signer.publicKey)],
      ['under the other token program', tokenAccount(TOKEN_2022_PROGRAM_ID, mint, signer.publicKey)],
      ['not a token account at all', account(SystemProgram.programId)],
    ] as const;
    for (const [, info] of cases) {
      const rpc = fakeRpc({ getAccountInfo: chainOf([[mint, mintAccount(TOKEN_PROGRAM_ID, 6)], [source, info]]) });
      await expect(sendTransfer({ ...spl('5'), source: source.toBase58() }, io(rpc, signer))).rejects.toThrow(
        'Token account mismatch',
      );
      expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    }
  });

  /**
   * The keyless Jupiter-sourced list carries no `source`, so this is the path every
   * one of its rows takes. Without the check in `buildTransfer` the estimate priced
   * a fee, Review enabled Confirm, and the failure arrived from preflight as a raw
   * simulation blob attached to a signature that never reached the cluster.
   */
  it('refuses a send with no source when the signer has no associated token account', async () => {
    const signer = Keypair.generate();
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 6) });

    await expect(sendTransfer(spl('5'), io(rpc, signer))).rejects.toThrow('Token account not found');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    // And it is priced as a failure on Review, not discovered at broadcast.
    await expect(estimateTransfer(spl('5'), io(rpc, signer))).rejects.toThrow('Token account not found');
  });

  it('reports the recipient ATA, not the wallet, and the rent a token account needs', async () => {
    const signer = Keypair.generate();
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_PROGRAM_ID);
    const sender: [PublicKey, AccountInfo<Buffer>] = [
      getAssociatedTokenAddressSync(mint, signer.publicKey, true, TOKEN_PROGRAM_ID),
      tokenAccount(TOKEN_PROGRAM_ID, mint, signer.publicKey),
    ];
    const absent = fakeRpc({ getAccountInfo: chainOf([[mint, mintAccount(TOKEN_PROGRAM_ID, 6)], sender]) });
    const missing = await estimateTransfer(spl('1'), io(absent, signer));
    expect(missing.recipient).toEqual({ exists: false, walletExists: false, isTokenAccount: false, offCurve: false });
    expect(missing.rentExemptMin).toBe(String(TOKEN_RENT));
    expect(absent.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(ACCOUNT_SIZE);

    // The wallet is there and so is its ATA: nothing to create.
    const present = fakeRpc({
      getAccountInfo: chainOf([
        [mint, mintAccount(TOKEN_PROGRAM_ID, 6)],
        sender,
        [recipient, account(SystemProgram.programId)],
        [destination, tokenAccount(TOKEN_PROGRAM_ID, mint, recipient)],
      ]),
    });
    expect((await estimateTransfer(spl('1'), io(present, signer))).recipient).toEqual({
      exists: true,
      walletExists: true,
      isTokenAccount: false,
      offCurve: false,
    });

    // A wallet with no token account of this mint yet: the send pays for one.
    const walletOnly = fakeRpc({
      getAccountInfo: chainOf([
        [mint, mintAccount(TOKEN_PROGRAM_ID, 6)],
        sender,
        [recipient, account(SystemProgram.programId)],
      ]),
    });
    const estimate = await estimateTransfer(spl('1'), io(walletOnly, signer));
    expect(estimate.recipient.exists).toBe(false);
    expect(estimate.recipient.walletExists).toBe(true);
  });
});

describe('confirmation', () => {
  const existing = () => vi.fn(async () => account(SystemProgram.programId));

  it('surfaces an on-chain error', async () => {
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: vi.fn(async () => ({
        context: { slot: 1 },
        value: [{ err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'confirmed' }] as Status[],
      })),
    });
    await expect(sendTransfer(sol('1000'), io(rpc))).rejects.toThrow(
      'Transaction failed on-chain: {"InstructionError":[0,{"Custom":1}]}',
    );
  });

  it('gives up once the chain has passed the last valid block height', async () => {
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: vi.fn(async () => ({ context: { slot: 1 }, value: [null] as Status[] })),
      getBlockHeight: vi.fn(async () => LAST_VALID + 1),
    });
    await expect(sendTransfer(sol('1000'), io(rpc))).rejects.toThrow(EXPIRED_MESSAGE);
    expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([SIGNATURE], { searchTransactionHistory: true });
  });

  it('keeps polling while the blockhash is still valid, then confirms', async () => {
    const statuses = vi
      .fn<[], Promise<{ context: { slot: number }; value: Status[] }>>()
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [null] })
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'processed' }] })
      .mockResolvedValue({ context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'finalized' }] });
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: statuses,
      getBlockHeight: vi.fn(async () => LAST_VALID),
    });
    const started = Date.now();
    await expect(sendTransfer(sol('1000'), io(rpc))).resolves.toBe(SIGNATURE);
    expect(statuses).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2 * CONFIRM_POLL_MS - 20);
  });

  it('rides out a transient RPC error while polling', async () => {
    const statuses = vi
      .fn<[], Promise<{ context: { slot: number }; value: Status[] }>>()
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValue({ context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'confirmed' }] });
    const rpc = fakeRpc({ getAccountInfo: existing(), getSignatureStatuses: statuses });
    await expect(sendTransfer(sol('1000'), io(rpc))).resolves.toBe(SIGNATURE);
    expect(statuses).toHaveBeenCalledTimes(2);
  });
});

describe('confirmation races', () => {
  const existing = () => vi.fn(async () => account(SystemProgram.programId));
  /** Status reads that never find the signature in the recent window. */
  const nothingRecent = () => vi.fn(async () => ({ context: { slot: 1 }, value: [null] as Status[] }));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run a send to its end, driving the 400 ms poll, and hand back whatever it threw. */
  async function failure(promise: Promise<string>): Promise<SendError> {
    const settled = promise.then(() => null, (error: unknown) => error as SendError);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + CONFIRM_POLL_MS);
    const error = await settled;
    if (!error) throw new Error('the send resolved');
    return error;
  }

  it('looks in the ledger before calling an expired blockhash a failure', async () => {
    // The status window has nothing, but the transaction landed just before the height passed.
    const statuses = vi.fn(async (_signatures: string[], options?: { searchTransactionHistory?: boolean }) => ({
      context: { slot: 1 },
      value: [options?.searchTransactionHistory ? { err: null, confirmationStatus: 'confirmed' } : null] as Status[],
    }));
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: statuses,
      getBlockHeight: vi.fn(async () => LAST_VALID + 1),
    });

    await expect(sendTransfer(sol('1000'), io(rpc))).resolves.toBe(SIGNATURE);
    expect(statuses).toHaveBeenCalledTimes(2);
    expect(statuses.mock.calls[0][1]).toEqual({ searchTransactionHistory: false });
    expect(statuses.mock.calls[1][1]).toEqual({ searchTransactionHistory: true });
  });

  it('expires with the signature after exactly one height check and one ledger look', async () => {
    const statuses = nothingRecent();
    const height = vi.fn(async () => LAST_VALID + 1);
    const rpc = fakeRpc({ getAccountInfo: existing(), getSignatureStatuses: statuses, getBlockHeight: height });

    const error = await failure(sendTransfer(sol('1000'), io(rpc)));
    expect(error).toBeInstanceOf(SendError);
    expect(error.code).toBe('expired');
    expect(error.reason).toBe(EXPIRED_MESSAGE);
    expect(error.signature).toBe(SIGNATURE);
    expect(error.message).toContain(SIGNATURE);
    // One pass: the recent read, the height check it failed, and the single history look.
    expect(height).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledTimes(2);
  });

  it('surfaces an on-chain failure found by the ledger look', async () => {
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: vi.fn(async (_signatures: string[], options?: { searchTransactionHistory?: boolean }) => ({
        context: { slot: 1 },
        value: [options?.searchTransactionHistory ? { err: { InstructionError: [0, 'Custom'] } } : null] as Status[],
      })),
      getBlockHeight: vi.fn(async () => LAST_VALID + 1),
    });
    await expect(sendTransfer(sol('1000'), io(rpc))).rejects.toThrow('Transaction failed on-chain');
  });

  it('gives up at the hard cap while the blockhash is still valid, keeping the signature', async () => {
    const statuses = nothingRecent();
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      getSignatureStatuses: statuses,
      getBlockHeight: vi.fn(async () => LAST_VALID),
    });

    const error = await failure(sendTransfer(sol('1000'), io(rpc)));
    expect(error.code).toBe('timeout');
    expect(error.reason).toBe(TIMED_OUT_MESSAGE);
    expect(error.signature).toBe(SIGNATURE);
    // 90 s of a 400 ms poll, not one look and out.
    expect(statuses.mock.calls.length).toBeGreaterThan(CONFIRM_TIMEOUT_MS / CONFIRM_POLL_MS / 2);
  });

  it('keeps the locally computed signature when the broadcast itself fails', async () => {
    const rpc = fakeRpc({
      getAccountInfo: existing(),
      sendRawTransaction: vi.fn(async () => {
        throw new Error('Transaction simulation failed: Blockhash not found');
      }),
    });

    const error = await failure(sendTransfer(sol('1000'), io(rpc)));
    expect(error.code).toBe('broadcast-failed');
    expect(error.reason).toContain('Blockhash not found');
    // The RPC said nothing, so the id comes from the signature the wallet put on the transaction.
    expect(error.signature).toBe(bs58.encode(broadcast(rpc).signature!));
    expect(rpc.getSignatureStatuses).not.toHaveBeenCalled();
  });
});

describe('the default io', () => {
  // Production passes no `io`: the signer comes from the keyring and the
  // connection from settings, both of which need `chrome.*`.
  beforeEach(() => {
    installChromeStub();
  });

  afterEach(() => {
    uninstallChromeStub();
  });

  it('refuses to price or send while the wallet is locked, before reaching an endpoint', async () => {
    rotate.readyConnection.mockClear();
    // No session, so no keypair.
    await expect(estimateTransfer(sol('1'))).rejects.toThrow('Wallet is locked');
    await expect(sendTransfer(sol('1'))).rejects.toThrow('Wallet is locked');
    // And `defaultIo` asks for the signer first, so neither call ever resolved a
    // connection, let alone talked to one: the refusal is not a network round trip.
    expect(rotate.readyConnection).not.toHaveBeenCalled();
  });
});
