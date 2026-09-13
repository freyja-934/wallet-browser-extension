import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, Transaction, type AccountInfo, type Connection, type Message } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_POLL_MS,
  EXPIRED_MESSAGE,
  estimateTransfer,
  FALLBACK_FEE_LAMPORTS,
  sendTransfer,
  type TransferIo,
} from './transfers';

const SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const RENT = 890_880;
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
function fakeRpc(overrides: Partial<Record<keyof Rpc, (...args: any[]) => Promise<unknown>>> = {}) {
  const base = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: LAST_VALID })),
    getFeeForMessage: vi.fn(async (_message: Message) => ({ context: { slot: 1 }, value: 5000 as number | null })),
    getMinimumBalanceForRentExemption: vi.fn(async () => RENT),
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

/** `getAccountInfo` that knows the mint and otherwise says "no account". */
function chainWithMint(mint: PublicKey, programId: PublicKey, decimals: number) {
  return vi.fn(async (address: PublicKey): Promise<AccountInfo<Buffer> | null> =>
    address.equals(mint) ? mintAccount(programId, decimals) : null,
  );
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
      recipient: { exists: false, isTokenAccount: false, offCurve: false },
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
      isTokenAccount: false,
      offCurve: false,
    });

    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const tokenAccount = fakeRpc({ getAccountInfo: vi.fn(async () => account(program)) });
      expect((await estimateTransfer(sol('1'), io(tokenAccount))).recipient).toEqual({
        exists: true,
        isTokenAccount: true,
        offCurve: false,
      });
    }

    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('cinder')], TOKEN_PROGRAM_ID);
    const rpc = fakeRpc();
    expect((await estimateTransfer({ to: pda.toBase58(), amountSmallest: '1' }, io(rpc))).recipient).toEqual({
      exists: false,
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
    const rpc = fakeRpc({
      getFeeForMessage: vi.fn(async () => ({ context: { slot: 1 }, value: null })),
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
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 6) });
    const signer = Keypair.generate();
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
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_2022_PROGRAM_ID, 9) });
    const signer = Keypair.generate();
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
  });

  it('sends to an off-curve owner, deriving its ATA', async () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], SystemProgram.programId);
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 0) });
    await sendTransfer({ to: pda.toBase58(), amountSmallest: '1', mint: mint.toBase58() }, io(rpc));
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
    const rpc = fakeRpc({ getAccountInfo: chainWithMint(mint, TOKEN_PROGRAM_ID, 6) });
    const estimate = await estimateTransfer(spl('1'), io(rpc));
    expect(estimate.feeLamports).toBe('5000');
    const [message] = rpc.getFeeForMessage.mock.calls[0];
    expect(message.compiledInstructions).toHaveLength(2);
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
