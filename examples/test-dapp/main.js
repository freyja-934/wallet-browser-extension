import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

window.Buffer = Buffer;

const onDevnet = import.meta.env.VITE_NETWORK === 'devnet';
const rpcUrl = onDevnet
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';
const clusterChain = onDevnet ? 'solana:devnet' : 'solana:mainnet';

const logEl = document.getElementById('log');
const log = (value) => {
  logEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

let wallet = null;

const register = (registered) => {
  if (registered.name === 'Cinder Wallet') wallet = registered;
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
    log({ accounts: accounts.map((account) => account.address) });
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

async function buildSelfTransfer(account) {
  const address = account.address;
  const pubkey = new PublicKey(address);
  const connection = new Connection(rpcUrl, 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash().catch(() => ({
    blockhash: PublicKey.default.toBase58(),
  }));
  const ix = SystemProgram.transfer({
    fromPubkey: pubkey,
    toPubkey: pubkey,
    lamports: 0,
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
    log({
      signedBytes: out.signedTransaction.length,
      note: 'v0 self-transfer of 0 lamports — previewed and signed, not sent',
    });
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
    log({ signature: [...out.signature] });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
  }
};
