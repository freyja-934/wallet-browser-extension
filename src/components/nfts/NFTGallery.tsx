import { useMemo, useState, type ReactNode } from 'react';
import { accountAt } from '../../lib/messages';
import { useNFTs } from '../../hooks/useWalletQueries';
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

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    // `refetch` never rejects: a failure lands in `isError` and the card below.
    await refetch();
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

  if (isLoading && nfts.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <Skeleton className="aspect-square rounded-2xl" />
        <Skeleton className="aspect-square rounded-2xl" />
      </div>
    );
  }

  // No configured endpoint serves DAS: a configuration state, not an empty wallet.
  if (data?.nftsUnavailable) {
    return (
      <div className="px-4 py-4">
        <EmptyState
          icon="nft"
          title="Collectibles need an endpoint"
          body="The configured RPC endpoints do not serve NFT data."
        />
        <p className="-mt-6 px-6 text-center text-xs leading-relaxed text-fg-2" data-testid="nfts-unavailable">
          Add an RPC endpoint in <SettingsLink /> to see NFTs
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

      {Object.keys(nftCollections).length > 0 && (
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

      {filteredNFTs.length === 0 ? (
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
              <p className="text-sm text-fg-2">
                Collection:{' '}
                {selectedNFT.grouping?.find((g) => g.group_key === 'collection')?.group_value || 'Unknown'}
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
