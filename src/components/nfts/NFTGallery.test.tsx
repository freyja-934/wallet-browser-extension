// @vitest-environment jsdom
/**
 * The collectibles tab on a keyless Mainnet install, and — first — the promise
 * that it costs the home tab nothing.
 *
 * Tokens are the primary surface. Everything this phase added is lazy by
 * construction, and the first test here is what holds that construction in
 * place: the whole dashboard mounts, the token list renders for real, and not
 * one collectible metadata account is read nor one creator's host contacted.
 * A regression that moved any of that onto the balances path would fail here
 * before anyone noticed it in a popup.
 *
 * The rest of the file drives the tab itself through the real query layer, the
 * real services and the real endpoint rotation: the chrome stub is the worker,
 * the web3.js `Connection` is the chain, and `fetch` is Jupiter, the RPC and the
 * creator's metadata host.
 */

import '@testing-library/jest-dom/vitest';
import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, SolanaJSONRPCError, type AccountInfo } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JUPITER_BALANCES_URL, JUPITER_TOKEN_SEARCH_URL } from '../../config/constants';
import { DEFAULT_SETTINGS } from '../../lib/messages';
import { resetRpcCooldowns } from '../../lib/rpc-rotate';
import { METADATA_PROGRAM_ID, metadataPda } from '../../lib/token-metadata';
import { TEST_ADDRESS } from '../../test/fixtures';
import { acceptCrossRealmUint8Arrays } from '../../test/realm';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { makeQueryClient, makeStore, renderWithProviders } from '../../test/render';
import { stubChain, tokenAccounts } from '../../test/chain';
import { Dashboard } from '../Dashboard';

/** A fungible holding: six decimals, a real supply. Stays in the token list. */
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** The real Frog #8699: supply 1, decimals 0. Leaves the token list for this tab. */
const FROG = 'EUdecuyhrWqmohkuA4YvQcnNkDKUEHrfSD39xwVtJcpJ';
const FROG_URI = 'https://arweave.net/6IgALrodykXLT9llvFFIYIeuJKB2Klsmx9CM5fy_ewI';
const FROG_IMAGE = 'https://arweave.net/ykaMh3Ru-KKrzazec-kE_mW8Rz0iqyTc2UuMbHppMVQ?ext=png';

// Before the PDA below: `metadataPda` derives a program address, and web3.js does
// that with a Node `Buffer` that jsdom's `Uint8Array` would otherwise disown. The
// balances path derives an associated token address per mint for the same reason.
acceptCrossRealmUint8Arrays();

const FROG_PDA = metadataPda(new PublicKey(FROG)).toBase58();

let chrome: ChromeStub;

function mintAccount(decimals: number, supply: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(supply, 36);
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45);
  return { executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1_461_600, data };
}

function tokenAccountInfo(mint: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner: new PublicKey(TEST_ADDRESS),
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
  return { executable: false, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280, data };
}

/** A Metaplex metadata account, strings padded to the widths the program reserves. */
function metadataAccount(name: string, symbol: string, uri: string): AccountInfo<Buffer> {
  const str = (text: string, width: number) => {
    const body = Buffer.alloc(width);
    Buffer.from(text, 'utf8').copy(body);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(width, 0);
    return Buffer.concat([length, body]);
  };
  return {
    executable: false,
    owner: METADATA_PROGRAM_ID,
    lamports: 3_733_800,
    data: Buffer.concat([Buffer.from([4]), Buffer.alloc(64), str(name, 32), str(symbol, 10), str(uri, 200)]),
  };
}

/** A further 25 one-of-ones, for the paging and search cases. Deterministic addresses. */
const MANY = Array.from({ length: 25 }, (_, index) =>
  new PublicKey(Buffer.concat([Buffer.from([index + 1]), Buffer.alloc(31)])).toBase58(),
);
const MANY_NAME = new Map(MANY.map((mint, index) => [mint, `Gem #${index + 1}`]));
const MANY_PDA = new Map(MANY.map((mint) => [metadataPda(new PublicKey(mint)).toBase58(), mint]));

describe('collectibles, keyless Mainnet', () => {
  /** Every address `getMultipleAccountsInfo` was asked about, in order. */
  let asked: string[];
  /** Every URL `fetch` was called with, in order. */
  let requested: string[];
  /** What `GET_SETTINGS` answers; a test that configures an endpoint writes here. */
  let settings: Record<string, unknown>;

  function install(
    options: {
      metadata?: AccountInfo<Buffer> | null;
      document?: () => Response;
      /** `getParsedTokenAccountsByOwner`, which by default no keyless endpoint serves. */
      tokens?: () => Promise<ReturnType<typeof tokenAccounts>>;
      /** Extra one-of-one mints out of `MANY`, on top of FROG. */
      extra?: string[];
    } = {},
  ) {
    asked = [];
    requested = [];
    const extra = options.extra ?? [];

    stubChain({
      balance: async () => 5_000,
      tokens:
        options.tokens ??
        (async () => {
          throw new SolanaJSONRPCError({ code: -32602, message: 'Request blocked' }, 'failed to get token accounts');
        }),
    });

    const usdc = new PublicKey(USDC);
    const holding = getAssociatedTokenAddressSync(usdc, new PublicKey(TEST_ADDRESS), true, TOKEN_PROGRAM_ID);
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) =>
      keys.map((key) => {
        const address = key.toBase58();
        asked.push(address);
        if (address === USDC) return mintAccount(6, 1_000_000_000n);
        if (address === FROG) return mintAccount(0, 1n);
        if (MANY_NAME.has(address)) return mintAccount(0, 1n);
        if (address === holding.toBase58()) return tokenAccountInfo(usdc, 1_500_000n);
        if (address === FROG_PDA) {
          return options.metadata === undefined ? metadataAccount('Frog #8699', 'FROG', FROG_URI) : options.metadata;
        }
        const named = MANY_PDA.get(address);
        // No URI, so a page of these contacts no creator host: paging is what is under test.
        if (named !== undefined) return metadataAccount(MANY_NAME.get(named)!, 'GEM', '');
        return null;
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requested.push(url);
        if (url.startsWith(`${JUPITER_BALANCES_URL}/`)) {
          return Response.json({
            SOL: { amount: '5000', uiAmount: 0.000005 },
            [USDC]: { amount: '1500000', uiAmount: 1.5 },
            [FROG]: { amount: '1', uiAmount: 1 },
            ...Object.fromEntries(extra.map((mint) => [mint, { amount: '1', uiAmount: 1 }])),
          });
        }
        if (url.startsWith(JUPITER_TOKEN_SEARCH_URL)) {
          return Response.json([{ id: USDC, name: 'USD Coin', symbol: 'USDC' }]);
        }
        if (url === FROG_URI) {
          return options.document ? options.document() : Response.json({ name: 'Frog #8699', image: FROG_IMAGE });
        }
        // Every RPC POST, DAS included: this host serves neither.
        const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string }) : {};
        return Response.json({ jsonrpc: '2.0', id: 'cinder', error: { code: -32601, message: `no ${body.method}` } });
      }),
    );
  }

  const openCollectibles = () => fireEvent.click(screen.getByTestId('nav-nfts'));

  beforeEach(() => {
    // The shell's backdrop asks for the reduced-motion preference; jsdom has no
    // `matchMedia`, and a missing one throws out of an effect and unmounts the tree.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    settings = { ...DEFAULT_SETTINGS, cluster: 'mainnet-beta' };
    chrome = installChromeStub();
    chrome.runtime.respond((message) => {
      const { type } = message as { type?: string };
      if (type === 'GET_SETTINGS') return { success: true, settings };
      return { success: false, error: `unexpected ${String(type)}` };
    });
  });

  afterEach(() => {
    cleanup();
    uninstallChromeStub();
    resetRpcCooldowns();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Step one of the phase, seen from the screen: the mint the wallet holds one
   * indivisible unit of is a collectible, and a collectible is not a row in the
   * token list. Before this it read as a balance of "1".
   */
  it('keeps the one-of-one out of the token list', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });

    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    expect(screen.queryByTestId(`asset-${FROG}`)).toBeNull();
    // And it is not reported as a holding the endpoint refused, because it was not.
    expect(screen.getByTestId('tokens-from-jupiter')).not.toHaveTextContent('would not confirm');
  });

  /**
   * The load-bearing promise of the whole phase. Collectible metadata is a chain
   * read and a creator's host is an arbitrary third party; neither may happen
   * because the user opened the wallet.
   */
  it('reads no collectible metadata and contacts no creator host from the home tab', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });

    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));
    // Nothing is in flight behind the render either.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(asked).not.toContain(FROG_PDA);
    expect(requested).not.toContain(FROG_URI);
    expect(requested.some((url) => url.startsWith('https://arweave.net/'))).toBe(false);
  });

  it('names and pictures the collectible once the tab is opened', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    const image = await screen.findByAltText('Frog #8699');
    expect(image).toHaveAttribute('src', FROG_IMAGE);
    expect(asked).toContain(FROG_PDA);
  });

  it('shows an item whose metadata account cannot be read, by its mint', async () => {
    install({ metadata: null });
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    // Its short mint, which is a fact, rather than "Unnamed NFT", which is not.
    expect(await screen.findByText('EUde…JcpJ')).toBeInTheDocument();
    // No document to follow, so no host was contacted for it.
    expect(requested).not.toContain(FROG_URI);
  });

  it.each([
    ['is not JSON at all', () => new Response('<!DOCTYPE html><title>Found</title>', { status: 200 })],
    ['refuses the request', () => new Response('nope', { status: 403 })],
    ['names an image over plain http', () => Response.json({ image: 'http://arweave.net/a.png' })],
    ['names a data-URI image', () => Response.json({ image: 'data:image/svg+xml,<svg onload="alert(1)"/>' })],
  ])('still shows the collectible, with no picture, when the document %s', async (_label, document) => {
    install({ document });
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    expect(await screen.findByText('Frog #8699')).toBeInTheDocument();
    await waitFor(() => expect(requested).toContain(FROG_URI));
    expect(screen.queryByAltText('Frog #8699')).toBeNull();
  });

  /**
   * The gate, and the reason it takes two conditions rather than one.
   *
   * "No endpoint serves DAS" and "the keyless discovery ran" are independent:
   * the second needs Mainnet *and* no RPC URL and no Helius key of the user's
   * own. A user who entered their own DAS-less endpoint satisfies only the
   * first, and telling them nothing they hold reads as a one-of-one would be a
   * claim about holdings nothing had looked at — under a note saying their
   * address went to Jupiter when their own settings are what stopped it going.
   */
  it('asks for an endpoint, rather than reporting an empty collection, when the keyless discovery never ran', async () => {
    settings.rpcUrl = 'https://rpc.example.com';
    install({ tokens: async () => tokenAccounts([]) });
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });

    openCollectibles();

    expect(await screen.findByTestId('nfts-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('collectibles-keyless-note')).toBeNull();
    expect(screen.queryByText(/reads as a one-of-one/)).toBeNull();
    // And nothing went to Jupiter, which is the promise the note would have broken.
    expect(requested.some((url) => url.startsWith(JUPITER_BALANCES_URL))).toBe(false);
  });

  /**
   * `grouping` is an on-chain *verified* collection; `symbol` is a free string
   * whoever wrote the metadata chose. A keyless read has only the second, and a
   * scam airdropped with the symbol "Mad Lads" must not render where a verified
   * Mad Lads grouping would.
   */
  it('does not present the mint\'s own symbol as its collection', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    expect(await screen.findByText('Frog #8699')).toBeInTheDocument();
    expect(screen.queryByText('FROG')).toBeNull();
    expect(screen.getByText('Unknown collection')).toBeInTheDocument();
  });

  /**
   * Twenty a page, and — the part that is easy to get wrong — the control that
   * reads the next page stays put while a search is open. A search filters the
   * pages already read, so hiding it is what leaves a user unable to reach the
   * item they typed the name of.
   */
  it('reads twenty at a time and keeps the load-more control while searching', async () => {
    install({ extra: MANY });
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    // FROG plus Gem #1..#19 is the first page; the other six are not read yet.
    expect(await screen.findByText('Gem #19')).toBeInTheDocument();
    expect(screen.queryByText('Gem #20')).toBeNull();
    expect(screen.getByTestId('collectibles-more')).toHaveTextContent('Read 6 more');

    fireEvent.change(screen.getByPlaceholderText('Search collectibles'), { target: { value: 'Gem #25' } });

    // It is not read yet, and the screen says exactly that rather than "no matches".
    expect(screen.queryByText('Gem #25')).toBeNull();
    expect(screen.getByText(/read so far/)).toBeInTheDocument();
    // The way out of it is still on screen.
    fireEvent.click(screen.getByTestId('collectibles-more'));
    expect(await screen.findByText('Gem #25')).toBeInTheDocument();
  });

  /**
   * Refresh on this tab must re-read what this tab shows. The list comes from
   * the balances query and `['collectibles']`, and neither is `useNFTs`, so a
   * refresh that only retried DAS would spin and change nothing.
   */
  it('re-reads the keyless list on refresh, not only DAS', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();
    expect(await screen.findByText('Frog #8699')).toBeInTheDocument();
    const reads = () => asked.filter((address) => address === FROG_PDA).length;
    expect(reads()).toBe(1);

    fireEvent.click(screen.getByLabelText('Refresh NFTs'));

    await waitFor(() => expect(reads()).toBeGreaterThan(1));
  });

  /**
   * An incomplete grid must not read as a complete collection. Compressed NFTs
   * have no mint account, so nothing keyless can see them at all.
   */
  it('says plainly that compressed collectibles are missing, and why', async () => {
    install();
    renderWithProviders(<Dashboard />, { store: makeStore(), queryClient: makeQueryClient() });
    await waitFor(() => expect(screen.getByTestId(`asset-${USDC}`)).toHaveTextContent('1.5'));

    openCollectibles();

    const note = await screen.findByTestId('collectibles-compressed-note');
    expect(note).toHaveTextContent('Compressed collectibles are not listed');
    expect(note).toHaveTextContent('airdrops and free mints');
    expect(note).toHaveTextContent('DAS indexer');
    expect(note).toHaveTextContent('not your whole collection');
  });
});
