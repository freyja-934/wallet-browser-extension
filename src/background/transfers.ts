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
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getRpcUrl } from '../config/constants';
import { getKeypair } from './keyring';

export function getConnection(): Connection {
  return new Connection(getRpcUrl(), 'confirmed');
}

export async function sendTransfer(params: {
  to: string;
  amountSmallest: string;
  mint?: string;
}): Promise<string> {
  const keypair = await getKeypair();
  const connection = getConnection();
  const amount = BigInt(params.amountSmallest);

  if (!params.mint) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(params.to),
        lamports: amount,
      })
    );
    return sendAndConfirmTransaction(connection, tx, [keypair]);
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
        mint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      fromAta,
      toAta,
      keypair.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return sendAndConfirmTransaction(connection, tx, [keypair]);
}
