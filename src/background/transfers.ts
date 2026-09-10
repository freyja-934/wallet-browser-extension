import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { getCluster } from '../config/constants';
import { errorMessage } from '../lib/errors';
import { readyConnection } from '../lib/rpc-rotate';
import { getSettings, getKeypair } from './keyring';

export async function getConnection(): Promise<Connection> {
  const settings = await getSettings();
  return readyConnection(settings.cluster ?? getCluster());
}

async function sendLegacy(connection: Connection, tx: Transaction, signer: Awaited<ReturnType<typeof getKeypair>>): Promise<string> {
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } catch (error) {
    throw new Error(errorMessage(error, 'Broadcast failed'));
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const value = status.value;
    if (value?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(value.err)}`);
    }
    if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Confirmation timed out. Check the explorer before retrying.');
}

export async function sendTransfer(params: {
  to: string;
  amountSmallest: string;
  mint?: string;
}): Promise<string> {
  const keypair = await getKeypair();
  const connection = await getConnection();
  const amount = BigInt(params.amountSmallest);

  if (!params.mint) {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Amount too large');
    }
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(params.to),
        lamports: Number(amount),
      }),
    );
    return sendLegacy(connection, tx, keypair);
  }

  const mint = new PublicKey(params.mint);
  const to = new PublicKey(params.to);
  const fromAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const toAta = await getAssociatedTokenAddress(mint, to);
  const tx = new Transaction();

  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        toAta,
        to,
        mint,
      ),
    );
  }

  tx.add(
    createTransferInstruction(
      fromAta,
      toAta,
      keypair.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  return sendLegacy(connection, tx, keypair);
}
