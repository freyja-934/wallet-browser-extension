import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { setNftViewMode, setRefreshing } from '../../store/slices/uiSlice';
import { useNFTs } from '../../hooks/useWalletQueries';
import { NFT } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { NFTCard } from './NFTCard';

export const NFTGallery: React.FC = () => {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const address = accounts[activeAccountIndex]?.address;
  const { data, isLoading, refetch } = useNFTs(address);
  const nfts = React.useMemo(() => data?.nfts ?? [], [data]);
  const nftCollections = React.useMemo(() => data?.nftCollections ?? {}, [data]);
  const { nftViewMode, isRefreshing } = useAppSelector(state => state.ui);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    try {
      await refetch();
      toast.success('NFTs refreshed!');
    } catch {
      toast.error('Failed to refresh NFTs');
    } finally {
      dispatch(setRefreshing(false));
    }
  };

  // Filter NFTs based on collection and search
  const filteredNFTs = React.useMemo(() => {
    let filtered = selectedCollection && nftCollections[selectedCollection]
      ? nftCollections[selectedCollection]
      : nfts;

    if (searchQuery) {
      filtered = filtered.filter((nft: NFT) => 
        nft.content.metadata.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        nft.content.metadata.symbol?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  }, [nfts, nftCollections, selectedCollection, searchQuery]);

  const handleNFTClick = (nft: typeof nfts[0]) => {
    setSelectedNFT(nft);
  };

  if (isLoading && nfts.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-a"></div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Search and Controls */}
      <div className="space-y-3">
        <div className="relative">
          <TextField
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search NFTs..."
            className="pl-10"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Collection Filter */}
        {Object.keys(nftCollections).length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <CollectionPill
              active={!selectedCollection}
              onClick={() => setSelectedCollection(null)}
            >
              All ({nfts.length})
            </CollectionPill>
            {Object.entries(nftCollections).map(([collection, items]) => (
              <CollectionPill
                key={collection}
                active={selectedCollection === collection}
                onClick={() => setSelectedCollection(collection)}
              >
                {collection} ({(items as NFT[]).length})
              </CollectionPill>
            ))}
          </div>
        )}
      </div>

      {/* NFT Grid/List */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-sm text-fg-1">NFTs ({filteredNFTs.length})</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh NFTs"
              className={`p-1.5 rounded-md hover:bg-bg-2 transition-colors ${
                isRefreshing ? 'animate-spin' : ''
              }`}
            >
              <svg className="w-4 h-4 text-fg-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <div className="flex rounded-md bg-bg-2 p-1">
              <ViewButton
                active={nftViewMode === 'grid'}
                onClick={() => dispatch(setNftViewMode('grid'))}
                aria-label="Grid view"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </ViewButton>
              <ViewButton
                active={nftViewMode === 'list'}
                onClick={() => dispatch(setNftViewMode('list'))}
                aria-label="List view"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </ViewButton>
            </div>
          </div>
        </CardHeader>

        {filteredNFTs.length === 0 ? (
          <CardContent>
            <p className="text-center text-fg-3 text-sm py-8">
              {searchQuery ? 'No NFTs found matching your search' : 'No NFTs in your wallet'}
            </p>
          </CardContent>
        ) : (
          <CardContent className={nftViewMode === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
            {filteredNFTs.map((nft) => (
              <NFTCard
                key={nft.id}
                nft={nft}
                onClick={() => handleNFTClick(nft)}
              />
            ))}
          </CardContent>
        )}
      </Card>

      {/* NFT Detail Modal */}
      <Modal isOpen={!!selectedNFT} onClose={() => setSelectedNFT(null)}>
        {selectedNFT && (
          <>
            <ModalHeader onClose={() => setSelectedNFT(null)}>
              {selectedNFT.content.metadata.name || 'NFT Details'}
            </ModalHeader>
            <ModalContent className="space-y-4">
              <div className="aspect-square bg-bg-2 rounded-lg overflow-hidden relative">
                {(selectedNFT.content.links?.image || selectedNFT.content.files?.[0]?.uri) ? (
                  <img
                    src={selectedNFT.content.links?.image || selectedNFT.content.files?.[0]?.uri}
                    alt={selectedNFT.content.metadata.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div className={`${(selectedNFT.content.links?.image || selectedNFT.content.files?.[0]?.uri) ? 'hidden' : ''} absolute inset-0 flex items-center justify-center`}>
                  <div className="text-6xl text-fg-3">🖼️</div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-fg-2">
                  Collection: {selectedNFT.grouping?.find((g: any) => g.group_key === 'collection')?.group_value || 'Unknown'}
                </p>
                {selectedNFT.content.metadata.description && (
                  <p className="text-sm text-fg-2">
                    {selectedNFT.content.metadata.description}
                  </p>
                )}
                {selectedNFT.compression?.compressed && (
                  <p className="text-xs text-fg-3">
                    Compressed NFT (cNFT)
                  </p>
                )}
              </div>
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3 w-full">
                <SecondaryButton onClick={() => setSelectedNFT(null)} className="flex-1">
                  Close
                </SecondaryButton>
                <PrimaryButton 
                  onClick={() => {
                    toast('NFT transfer coming soon!');
                    setSelectedNFT(null);
                  }}
                  className="flex-1"
                >
                  Send
                </PrimaryButton>
              </div>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
};

function CollectionPill({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-brand-a text-white'
          : 'bg-bg-2 text-fg-1 hover:bg-bg-1 border border-ui-border'
      }`}
    >
      {children}
    </button>
  );
}

function ViewButton({ children, active, onClick, ...props }: { children: React.ReactNode; active: boolean; onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded-sm transition-colors ${
        active
          ? 'bg-bg-1 text-fg-0'
          : 'text-fg-2 hover:text-fg-1'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}