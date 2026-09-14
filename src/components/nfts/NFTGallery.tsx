import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { accountAt } from '../../lib/messages';
import { useBalances, useCollectibles, useNFTs } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { isEndpointsUnreachable } from '../../services/helius';
import { setNftViewMode, setRefreshing } from '../../store/slices/uiSlice';
import type { NFT } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { EmptyState, EndpointsUnreachableBody, ErrorCard, SettingsLink, Skeleton } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { SecondaryButton } from '../ui/Button';
import { CollectibleCard, collectibleLabel } from './CollectibleCard';
import { NFTCard } from './NFTCard';

export function NFTGallery() {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const address = accountAt(accounts, activeAccountIndex)?.address;
  const { data, isLoading, isError, error, refetch } = useNFTs(address);
  const nfts = useMemo(() => data?.nfts ?? [], [data]);
  const nftCollections = useMemo(() => data?.nftCollections ?? {}, [data]);
  const { nftViewMode, isRefreshing } = useAppSelector((state) => state.ui);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);

  /** No endpoint here serves DAS. On its own that says nothing about collectibles. */
  const dasUnavailable = data?.nftsUnavailable === true;

  /**
   * Balances matter to this tab only when DAS is out, because they are the only
   * thing that says whether the keyless one-of-one discovery actually ran. An
   * `undefined` address disables the query outright, so an install that does have
   * DAS subscribes to nothing extra here.
   */
  const {
    data: balances,
    isLoading: balancesLoading,
    refetch: refetchBalances,
  } = useBalances(dasUnavailable ? address : undefined);
  const queryClient = useQueryClient();

  /**
   * The keyless collectibles branch, and it takes **both** conditions.
   *
   * `nftsUnavailable` says only that no endpoint here answers DAS. The keyless
   * discovery runs on an entirely different test — `jupiterEnabledFor`: mainnet,
   * and no RPC URL and no Helius key of the user's own — so the two diverge
   * exactly where it matters. A user who entered their own DAS-less endpoint has
   * no `collectibles` list at all, and telling them "nothing reads as a
   * one-of-one" would be a claim about holdings nothing ever looked at, under a
   * note saying their address went to Jupiter when it never did. That case gets
   * the endpoint guidance below instead, which is what it got before this tab
   * existed.
   */
  const keyless = dasUnavailable && balances?.tokensSource === 'jupiter';

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    // `refetch` never rejects: a failure lands in `isError` and the card below.
    // On the keyless branch nothing on screen came from `useNFTs` at all — the
    // mints come from the balances query and the names from `['collectibles']` —
    // so refreshing DAS alone would spin and change nothing the user can see.
    await Promise.all([
      refetch(),
      ...(keyless ? [refetchBalances(), queryClient.invalidateQueries({ queryKey: ['collectibles'] })] : []),
    ]);
    dispatch(setRefreshing(false));
  };

  const filteredNFTs = useMemo(() => {
    let filtered = selectedCollection && nftCollections[selectedCollection]
      ? nftCollections[selectedCollection]
      : nfts;
    if (searchQuery) {
      filtered = filtered.filter(
        (nft) =>
          nft.content.metadata.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          nft.content.metadata.symbol?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }
    return filtered;
  }, [nfts, nftCollections, selectedCollection, searchQuery]);

  if (isError) {
    return (
      <div className="px-4 py-4">
        <ErrorCard
          testId="nfts-error"
          title="Could not load collectibles"
          body={isEndpointsUnreachable(error) ? <EndpointsUnreachableBody /> : errorMessage(error, 'The RPC endpoint did not answer.')}
          onRetry={handleRefresh}
        />
      </div>
    );
  }

  if ((isLoading && nfts.length === 0) || (dasUnavailable && balancesLoading)) {
    return (
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <Skeleton className="aspect-square rounded-2xl" />
        <Skeleton className="aspect-square rounded-2xl" />
      </div>
    );
  }

  // No endpoint serves DAS *and* the keyless discovery did not run — the user
  // configured an endpoint of their own that has no DAS add-on, or Jupiter had
  // nothing to say. Nothing has looked at this wallet's collectibles, so the
  // honest screen is the one that asks for an endpoint, not one that reports an
  // empty collection.
  if (dasUnavailable && !keyless) {
    return (
      <div className="px-4 py-4">
        <EmptyState
          icon="nft"
          title="Collectibles need an endpoint"
          body="Listing what a wallet holds takes the DAS API, and no free endpoint serves it on Mainnet. Cinder will not guess this one from a third party."
        />
        <p className="-mt-6 px-6 text-center text-xs leading-relaxed text-fg-2" data-testid="nfts-unavailable">
          Add your own RPC endpoint or a Helius key in <SettingsLink /> to see NFTs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-4 pt-4">
      <div className="relative">
        <TextField
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search collectibles"
          className="pl-11"
        />
        <Icon name="search" className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
      </div>

      {!keyless && Object.keys(nftCollections).length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <CollectionPill active={!selectedCollection} onClick={() => setSelectedCollection(null)}>
            All ({nfts.length})
          </CollectionPill>
          {Object.entries(nftCollections).map(([collection, items]) => (
            <CollectionPill
              key={collection}
              active={selectedCollection === collection}
              onClick={() => setSelectedCollection(collection)}
            >
              {collection} ({items.length})
            </CollectionPill>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Collectibles</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh NFTs"
            className={`p-1.5 text-fg-2 ${isRefreshing ? 'animate-spin' : ''}`}
          >
            <Icon name="refresh" className="h-4 w-4" />
          </button>
          <button
            aria-label="Grid view"
            onClick={() => dispatch(setNftViewMode('grid'))}
            className={`rounded-full p-1.5 ${nftViewMode === 'grid' ? 'bg-white/10 text-fg-0' : 'text-fg-3'}`}
          >
            <Icon name="grid" className="h-4 w-4" />
          </button>
          <button
            aria-label="List view"
            onClick={() => dispatch(setNftViewMode('list'))}
            className={`rounded-full p-1.5 ${nftViewMode === 'list' ? 'bg-white/10 text-fg-0' : 'text-fg-3'}`}
          >
            <Icon name="list" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {keyless ? (
        <KeylessCollectibles
          mints={balances?.collectibles ?? []}
          search={searchQuery}
          layout={nftViewMode}
          onSelect={setSelectedNFT}
        />
      ) : filteredNFTs.length === 0 ? (
        <EmptyState
          icon="nft"
          title={searchQuery ? 'No matches' : 'No collectibles'}
          body={searchQuery ? 'Try a different search.' : 'NFTs you receive will show up here.'}
        />
      ) : (
        <div className={nftViewMode === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
          {filteredNFTs.map((nft) => (
            <NFTCard key={nft.id} nft={nft} layout={nftViewMode} onClick={() => setSelectedNFT(nft)} />
          ))}
        </div>
      )}

      <Modal isOpen={!!selectedNFT} onClose={() => setSelectedNFT(null)}>
        {selectedNFT && (
          <>
            <ModalHeader onClose={() => setSelectedNFT(null)}>
              {selectedNFT.content.metadata.name || 'Collectible'}
            </ModalHeader>
            <ModalContent className="space-y-4">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-white/5">
                {(selectedNFT.content.links?.image || selectedNFT.content.files?.[0]?.uri) ? (
                  <img
                    src={selectedNFT.content.links?.image || selectedNFT.content.files?.[0]?.uri}
                    alt={selectedNFT.content.metadata.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-fg-3">
                    <Icon name="nft" className="h-10 w-10" />
                  </div>
                )}
              </div>
              {/* The verified collection only; see the note in `NFTCard`. */}
              <p className="text-sm text-fg-2">
                Collection: {selectedNFT.grouping?.find((g) => g.group_key === 'collection')?.group_value || 'Unknown'}
              </p>
              {selectedNFT.content.metadata.description && (
                <p className="text-sm text-fg-2">{selectedNFT.content.metadata.description}</p>
              )}
              {selectedNFT.compression?.compressed && (
                <p className="text-xs text-fg-3">Compressed NFT (cNFT)</p>
              )}
            </ModalContent>
            <ModalFooter>
              <SecondaryButton onClick={() => setSelectedNFT(null)} className="w-full">
                Close
              </SecondaryButton>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}

/**
 * The collectibles a keyless Mainnet install can actually read.
 *
 * The mints come from the balances refresh that already ran for the token list —
 * the same Jupiter discovery, with the one-of-ones separated out on the chain's
 * own word (supply 1 at 0 decimals). Nothing is discovered again here. What this
 * adds is the Metaplex metadata account of each mint, a page at a time, and then
 * one off-chain document per card that is actually rendered.
 *
 * It is deliberately not silent about what it cannot show. Compressed NFTs have
 * no mint account and no token account at all, so neither Jupiter nor this wallet
 * can see them without a DAS indexer, and the note under the list says so rather
 * than letting an incomplete grid read as a complete one.
 */
function KeylessCollectibles({
  mints,
  search,
  layout,
  onSelect,
}: {
  /** From the balances the home tab already fetched; nothing is discovered here. */
  mints: string[];
  search: string;
  layout: 'grid' | 'list';
  onSelect: (nft: NFT) => void;
}) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useCollectibles(mints);

  const items = useMemo(() => (data?.pages ?? []).flat(), [data]);
  const query = search.trim().toLowerCase();
  const shown = query
    ? items.filter(
        (item) =>
          collectibleLabel(item).toLowerCase().includes(query) ||
          item.symbol?.toLowerCase().includes(query) ||
          item.mint.toLowerCase().includes(query),
      )
    : items;

  if (mints.length > 0 && isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="aspect-square rounded-2xl" />
        <Skeleton className="aspect-square rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {shown.length === 0 ? (
        <EmptyState
          icon="nft"
          title={query ? 'No matches' : 'No collectibles'}
          body={
            query
              ? // A search runs over the pages read so far, not over the whole
                // list, so "no matches" is only ever true of what has been read.
                `Nothing among the ${items.length === 1 ? '1 collectible' : `${items.length} collectibles`} read so far.`
              : 'Nothing this wallet holds reads as a one-of-one. Collectibles you receive will show up here.'
          }
        />
      ) : (
        <div className={layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
          {shown.map((item) => (
            <CollectibleCard key={item.mint} item={item} layout={layout} onSelect={onSelect} />
          ))}
        </div>
      )}

      {/* Rendered whatever is typed: hiding it while a search is open is what
          leaves a user unable to reach the item they are searching for. */}
      {hasNextPage && (
        <SecondaryButton
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full"
          data-testid="collectibles-more"
        >
          {isFetchingNextPage ? 'Reading…' : `Read ${mints.length - items.length} more`}
        </SecondaryButton>
      )}

      <p className="px-2 text-center text-[11px] leading-relaxed text-fg-3" data-testid="collectibles-keyless-note">
        No endpoint here serves the DAS API, so this list is read straight from the chain: the mints came
        from Jupiter, and each name and picture from that mint&rsquo;s own metadata account. Pictures are
        fetched from whatever host the creator chose, only for the items shown. Jupiter is what says this
        address holds them: the chain confirmed each one is a one-of-one, not that it is still held. One
        refresh asks about at most 200 mints, and anything past that is counted under the token list.
      </p>
      <p className="px-2 text-center text-[11px] leading-relaxed text-fg-3" data-testid="collectibles-compressed-note">
        <strong className="font-medium text-fg-2">Compressed collectibles are not listed.</strong> Those are
        the cheap kind used for airdrops and free mints; they live as leaves in a Merkle tree with no mint
        account of their own, so only a DAS indexer can find them. Add your own RPC endpoint or a Helius key
        in <SettingsLink /> to see those too. This list is not your whole collection.
      </p>
    </div>
  );
}

function CollectionPill({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
        active ? 'bg-brand-b text-[#010000]' : 'border border-white/10 bg-white/5 text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}
