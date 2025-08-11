import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { setNftViewMode } from '../../store/slices/uiSlice';
import { fetchNFTs } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export const NFTGallery: React.FC = () => {
  const dispatch = useAppDispatch();
  const { nfts, nftCollections, isLoading } = useAppSelector(state => state.wallet);
  const { nftViewMode } = useAppSelector(state => state.ui);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [selectedNFT, setSelectedNFT] = useState<any | null>(null);

  useEffect(() => {
    // Fetch NFTs on mount
    dispatch(fetchNFTs());
  }, [dispatch]);

  const displayNFTs = selectedCollection 
    ? nftCollections[selectedCollection] || []
    : nfts;

  const getImageUrl = (nft: any) => {
    return nft.content?.links?.image || 
           nft.content?.files?.[0]?.uri || 
           '';
  };

  const getNFTName = (nft: any) => {
    return nft.content?.metadata?.name || 'Unnamed NFT';
  };

  const getCollectionName = (grouping: any[] | undefined) => {
    return grouping?.find(g => g.group_key === 'collection')?.group_value || 'Unknown Collection';
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            NFT Collection ({nfts.length})
          </h2>
          <div className="flex space-x-2">
            <button
              onClick={() => dispatch(setNftViewMode('grid'))}
              className={`p-2 rounded-lg transition-colors ${
                nftViewMode === 'grid' 
                  ? 'bg-indigo-100 text-indigo-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              onClick={() => dispatch(setNftViewMode('list'))}
              className={`p-2 rounded-lg transition-colors ${
                nftViewMode === 'list' 
                  ? 'bg-indigo-100 text-indigo-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Collection Filter */}
        {Object.keys(nftCollections).length > 0 && (
          <div className="flex items-center space-x-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCollection(null)}
              className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                !selectedCollection
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All NFTs
            </button>
            {Object.entries(nftCollections).map(([collectionName, items]) => (
              <button
                key={collectionName}
                onClick={() => setSelectedCollection(collectionName)}
                className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCollection === collectionName
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {collectionName} ({items.length})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* NFT Display */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : displayNFTs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">No NFTs found</p>
            <p className="text-sm mt-1">Your NFT collection will appear here</p>
          </div>
        ) : (
          <>
            {nftViewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-3">
                {displayNFTs.map((nft, index) => (
                  <motion.div
                    key={nft.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedNFT(nft)}
                    className="cursor-pointer group"
                  >
                    <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 mb-2">
                      <img
                        src={getImageUrl(nft)}
                        alt={getNFTName(nft)}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"%3E%3Cpath stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                    <h3 className="text-sm font-medium text-gray-900 truncate">
                      {getNFTName(nft)}
                    </h3>
                    <p className="text-xs text-gray-500 truncate">
                      {getCollectionName(nft.grouping)}
                    </p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {displayNFTs.map((nft, index) => (
                  <motion.div
                    key={nft.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedNFT(nft)}
                    className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                      <img
                        src={getImageUrl(nft)}
                        alt={getNFTName(nft)}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"%3E%3Cpath stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">
                        {getNFTName(nft)}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {getCollectionName(nft.grouping)}
                      </p>
                      {nft.compression?.compressed && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 mt-1">
                          Compressed
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* NFT Detail Modal */}
      <AnimatePresence>
        {selectedNFT && (
          <NFTDetailModal
            nft={selectedNFT}
            onClose={() => setSelectedNFT(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

interface NFTDetailModalProps {
  nft: any;
  onClose: () => void;
}

const NFTDetailModal: React.FC<NFTDetailModalProps> = ({ nft, onClose }) => {
  const getImageUrl = (nft: any) => {
    return nft.content?.links?.image || 
           nft.content?.files?.[0]?.uri || 
           '';
  };

  const getNFTName = (nft: any) => {
    return nft.content?.metadata?.name || 'Unnamed NFT';
  };

  const getDescription = (nft: any) => {
    return nft.content?.metadata?.description || 'No description available';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        {/* Image */}
        <div className="aspect-square bg-gray-100">
          <img
            src={getImageUrl(nft)}
            alt={getNFTName(nft)}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Details */}
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {getNFTName(nft)}
          </h2>
          <p className="text-gray-600 mb-4">
            {getDescription(nft)}
          </p>

          {/* Attributes */}
          {nft.content?.metadata?.attributes && (
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-2">Attributes</h3>
              <div className="grid grid-cols-2 gap-2">
                {nft.content.metadata.attributes.map((attr: any, index: number) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-2">
                    <p className="text-xs text-gray-500">{attr.trait_type}</p>
                    <p className="text-sm font-medium text-gray-900">{attr.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-3">
            <button className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
              Send NFT
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-900 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
