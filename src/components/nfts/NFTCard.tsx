import { NFT } from '../../store/slices/walletSlice';

interface NFTCardProps {
  nft: NFT;
  onClick?: () => void;
}

export function NFTCard({ nft, onClick }: NFTCardProps) {
  const imageUrl = nft.content.links?.image || nft.content.files?.[0]?.uri;
  
  const name = nft.content.metadata.name || 'Unnamed NFT';
  const collection = nft.grouping?.find(g => g.group_key === 'collection')?.group_value || 'Unknown Collection';
  const isCompressed = nft.compression?.compressed || false;

  return (
    <button
      onClick={onClick}
      className="group relative rounded-xl bg-bg-1 border border-ui-border overflow-hidden hover:border-ui-focus transition-all duration-base hover:shadow-card"
    >
      {/* Image */}
      <div className="aspect-square bg-bg-2 relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover transition-transform duration-slow group-hover:scale-105"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              target.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`${imageUrl ? 'hidden' : ''} absolute inset-0 flex items-center justify-center`}>
          <div className="text-4xl text-fg-3">🖼️</div>
        </div>
        {isCompressed && (
          <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-md bg-bg-0/80 text-fg-1 backdrop-blur-sm border border-ui-border">
            cNFT
          </span>
        )}
      </div>
      
      {/* Info */}
      <div className="p-3 space-y-1">
        <h4 className="text-sm font-medium text-fg-0 truncate">{name}</h4>
        <p className="text-xs text-fg-2 truncate">{collection}</p>
      </div>
    </button>
  );
}
