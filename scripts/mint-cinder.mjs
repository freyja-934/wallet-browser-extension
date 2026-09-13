import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Mint fixtures live beside this script; they are not shipped in the extension bundle.
const assets = path.join(repo, 'scripts', 'assets');
const localDir = path.join(repo, '.local');
const keypairPath = path.join(localDir, 'cinder-devnet.json');
const mnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const jwt = process.env.PINATA_JWT || process.env.VITE_PINATA_JWT;
if (!jwt) {
  throw new Error('Set PINATA_JWT or VITE_PINATA_JWT in .env');
}

mkdirSync(localDir, { recursive: true });
const seed = mnemonicToSeedSync(mnemonic);
const slip = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
const keypair = Keypair.fromSeed(slip.key);
writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));

const rpc = 'https://api.devnet.solana.com';

async function pinFile(filePath, name) {
  const blob = new Blob([readFileSync(filePath)]);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('pinataMetadata', JSON.stringify({ name }));
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Pinata file failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

async function pinJson(body, name) {
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataMetadata: { name },
      pinataContent: body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Pinata json failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

function mplx(args) {
  const result = spawnSync('mplx', [...args, '-k', keypairPath, '-r', rpc, '--json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'mplx failed').slice(0, 2000));
  }
  const text = (result.stdout || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const nftImage = await pinFile(path.join(assets, 'nft-img.png'), 'cinder-crew-001.png');
const nftVideo = await pinFile(path.join(assets, 'nft-video.mp4'), 'cinder-crew-001.mp4');
const tokenImage = await pinFile(path.join(assets, 'token-img.png'), 'cinder-token.png');

const collectionUri = await pinJson({
  name: 'Cinder Crew',
  symbol: 'CREW',
  description: 'The Cinder Crew — official collection of Cinder Wallet.',
  image: nftImage,
  properties: { files: [{ uri: nftImage, type: 'image/png' }], category: 'image' },
}, 'cinder-crew-collection.json');

const nftUri = await pinJson({
  name: 'Cinder Crew #001',
  symbol: 'CREW',
  description: 'Cinder Crew #001. A molten-core original from the Cinder Wallet crew.',
  image: nftImage,
  animation_url: nftVideo,
  attributes: [
    { trait_type: 'Collection', value: 'Cinder Crew' },
    { trait_type: 'Edition', value: '001' },
    { trait_type: 'Wallet', value: 'Cinder Wallet' },
  ],
  properties: {
    files: [
      { uri: nftImage, type: 'image/png' },
      { uri: nftVideo, type: 'video/mp4' },
    ],
    category: 'video',
  },
}, 'cinder-crew-001.json');

const collection = mplx([
  'core', 'collection', 'create',
  '--name', 'Cinder Crew',
  '--uri', collectionUri,
]);

const collectionId = collection.address || collection.publicKey || collection.collection || collection.id;
if (!collectionId) {
  throw new Error(`Could not read collection id from mplx: ${JSON.stringify(collection).slice(0, 500)}`);
}

const asset = mplx([
  'core', 'asset', 'create',
  '--name', 'Cinder Crew #001',
  '--uri', nftUri,
  '--collection', String(collectionId),
  '--owner', keypair.publicKey.toBase58(),
]);

const token = spawnSync('mplx', [
  'toolbox', 'token', 'create',
  '--name', 'Cinder',
  '--symbol', 'CNDR',
  '--description', 'Cinder ($CNDR) — the demo token of Cinder Wallet.',
  '--image', path.join(assets, 'token-img.png'),
  '--decimals', '6',
  '--mint-amount', '1000000',
  '-k', keypairPath,
  '-r', rpc,
  '--json',
], { encoding: 'utf8' });

if (token.status !== 0) {
  throw new Error((token.stderr || token.stdout || 'token create failed').slice(0, 2000));
}

writeFileSync(path.join(localDir, 'cinder-mints.json'), JSON.stringify({
  owner: keypair.publicKey.toBase58(),
  collection: collectionId,
  nft: asset,
  token: token.stdout,
  uris: { collectionUri, nftUri, nftImage, nftVideo, tokenImage },
}, null, 2));

console.log('Minted Cinder Crew collection, #001, and $CNDR to', keypair.publicKey.toBase58());
