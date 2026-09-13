import { Buffer } from 'buffer';
import bs58 from 'bs58';
import {
  Connection,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

window.Buffer = Buffer;

const onDevnet = import.meta.env.VITE_NETWORK === 'devnet';
// Not `api.mainnet-beta.solana.com`: it answers 403 to any request carrying an
// Origin header, so no browser page can read it. publicnode is the wallet's own
// mainnet default and accepts browser origins — though some networks (ISP
// filters, corporate DNS) block it too, in which case the blockhash read below
// falls back to a placeholder and says so in the log.
const rpcUrl = onDevnet
  ? 'https://api.devnet.solana.com'
  : 'https://solana-rpc.publicnode.com';
const clusterChain = onDevnet ? 'solana:devnet' : 'solana:mainnet';
/** The chain this build is not on: the wallet must refuse it with a Settings hint. */
const otherChain = onDevnet ? 'solana:mainnet' : 'solana:devnet';

const logEl = document.getElementById('log');
const log = (value) => {
  logEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

let wallet = null;

const register = (registered) => {
  if (registered.name !== 'Cinder Wallet') return log(`registered ${registered.name}`);
  wallet = registered;
  // Lock, disconnect, revoke, account and cluster changes arrive here as `change`;
  // a cluster change re-stamps every account's `chains`, so those are logged too.
  wallet.features['standard:events'].on('change', ({ accounts }) => {
    if (accounts) {
      log({ event: 'change', accounts: accounts.map((account) => account.address), chains: accounts[0]?.chains ?? [] });
    }
  });
  log(`registered ${registered.name}`);
};

window.addEventListener('wallet-standard:register-wallet', (event) => {
  event.detail({ register });
});
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } }));

document.getElementById('connect').onclick = async () => {
  if (!wallet) return log('No Cinder Wallet yet — load the extension, then refresh this page.');
  try {
    const { accounts } = await wallet.features['standard:connect'].connect();
    // `chains` follows the wallet's active cluster; wallet-adapter refuses to send otherwise.
    log({ accounts: accounts.map((account) => account.address), chains: accounts[0]?.chains ?? [] });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

document.getElementById('connectSilent').onclick = async () => {
  if (!wallet) return log('No Cinder Wallet yet — load the extension, then refresh this page.');
  try {
    // Never prompts: the accounts if this site is already connected, otherwise none.
    const { accounts } = await wallet.features['standard:connect'].connect({ silent: true });
    log({ silent: true, accounts: accounts.map((account) => account.address) });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

document.getElementById('signMessage').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    const message = new TextEncoder().encode('hello from lumen test dapp');
    const [out] = await wallet.features['solana:signMessage'].signMessage({
      account: wallet.accounts[0],
      message,
    });
    log({ signature: [...out.signature] });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

/** The message the second-account button signs; `e2e/dapp.spec.ts` verifies this exact text. */
const SECOND_ACCOUNT_MESSAGE = 'hello from the second account';

document.getElementById('signMessageSecond').onclick = async () => {
  // The account input is what picks the signer: this asks the account the wallet is
  // *not* on, so a signature made by the active one would be visibly wrong.
  if (!wallet?.accounts[1]) return log('Add a second account in the wallet, then connect');
  try {
    const account = wallet.accounts[1];
    const message = new TextEncoder().encode(SECOND_ACCOUNT_MESSAGE);
    const [out] = await wallet.features['solana:signMessage'].signMessage({ account, message });
    log({ account: account.address, signature: [...out.signature] });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

/** Poll getSignatureStatuses every second for up to 30 s; false on timeout. */
async function waitForConfirmation(connection, signature) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value } = await connection
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .catch(() => ({ value: [null] }));
    if (value[0]?.err) return false; // landed but failed on-chain
    const status = value[0]?.confirmationStatus;
    if (status === 'confirmed' || status === 'finalized') return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Set when the last blockhash read failed and an all-zero placeholder was used
 * instead. The wallet simulates with `replaceRecentBlockhash: true`, so the
 * preview and the signature are still real — but the bytes are not a
 * transaction the cluster would accept, and the log has to say so rather than
 * leave something that looks live. Cleared by the next read that succeeds.
 */
let blockhashNote = null;

/** The cluster's latest blockhash, or a placeholder plus a note saying why. */
async function recentBlockhash(connection) {
  try {
    const { blockhash } = await connection.getLatestBlockhash();
    blockhashNote = null;
    return blockhash;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    blockhashNote =
      `could not read a blockhash from ${rpcUrl} (${why}) — using an all-zero placeholder. ` +
      'The wallet replaces it when it simulates, so this transaction is previewed and signed ' +
      'for real but could never land on the cluster.';
    log(blockhashNote);
    return PublicKey.default.toBase58();
  }
}

/** A logged result, carrying the placeholder note when the last build had to use one. */
function withBlockhashNote(value) {
  return blockhashNote ? { ...value, blockhash: blockhashNote } : value;
}

async function buildSelfTransfer(account, lamports = 0) {
  const address = account.address;
  const pubkey = new PublicKey(address);
  const connection = new Connection(rpcUrl, 'confirmed');
  const blockhash = await recentBlockhash(connection);
  const ix = SystemProgram.transfer({
    fromPubkey: pubkey,
    toPubkey: pubkey,
    lamports,
  });
  const message = new TransactionMessage({
    payerKey: pubkey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

document.getElementById('signTx').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    const tx = await buildSelfTransfer(wallet.accounts[0]);
    const [out] = await wallet.features['solana:signTransaction'].signTransaction({
      account: wallet.accounts[0],
      transaction: tx.serialize(),
      chain: clusterChain,
    });
    log(
      withBlockhashNote({
        signedBytes: out.signedTransaction.length,
        note: 'v0 self-transfer of 0 lamports — previewed and signed, not sent',
      }),
    );
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

document.getElementById('signAndSend').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    const tx = await buildSelfTransfer(wallet.accounts[0]);
    const [out] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
      account: wallet.accounts[0],
      transaction: tx.serialize(),
      chain: clusterChain,
    });
    const signature = bs58.encode(out.signature);
    log(withBlockhashNote({ signatureLength: out.signature.length, signature, confirmed: 'pending…' }));
    const connection = new Connection(rpcUrl, 'confirmed');
    const confirmed = await waitForConfirmation(connection, signature);
    log(withBlockhashNote({ signatureLength: out.signature.length, signature, confirmed }));
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

/** The lamports of the one transfer in a signed self-transfer, so the outputs' order is observable. */
function transferLamports(signedTransaction) {
  const tx = VersionedTransaction.deserialize(signedTransaction);
  const [ix] = TransactionMessage.decompile(tx.message).instructions;
  return Number(SystemInstruction.decodeTransfer(ix).lamports);
}

document.getElementById('signAll').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    // Two transactions, one call: the wallet opens one approval window and answers both in
    // order. They transfer 1 and 2 lamports so the order of the outputs can be checked.
    const [first, second] = await Promise.all([
      buildSelfTransfer(wallet.accounts[0], 1),
      buildSelfTransfer(wallet.accounts[0], 2),
    ]);
    const outs = await wallet.features['solana:signTransaction'].signTransaction(
      { account: wallet.accounts[0], transaction: first.serialize(), chain: clusterChain },
      { account: wallet.accounts[0], transaction: second.serialize(), chain: clusterChain },
    );
    log(
      withBlockhashNote({
        signedCount: outs.length,
        signedBytes: outs.map((out) => out.signedTransaction.length),
        lamports: outs.map((out) => transferLamports(out.signedTransaction)),
      }),
    );
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

document.getElementById('signWrongChain').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    const tx = await buildSelfTransfer(wallet.accounts[0]);
    await wallet.features['solana:signTransaction'].signTransaction({
      account: wallet.accounts[0],
      transaction: tx.serialize(),
      chain: otherChain,
    });
    log({ error: `wallet signed for ${otherChain}; it should have refused` });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};

document.getElementById('signTxAsMessage').onclick = async () => {
  if (!wallet?.accounts[0]) return log('Connect first');
  try {
    // The serialized message of a transaction: a signature over it would be a valid transaction signature.
    const tx = await buildSelfTransfer(wallet.accounts[0]);
    await wallet.features['solana:signMessage'].signMessage({
      account: wallet.accounts[0],
      message: tx.message.serialize(),
    });
    log({ error: 'wallet signed a transaction message as a message; it should have refused' });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};
