import type { NFT } from '../../store/slices/walletSlice';
import { Icon } from '../ui/Icon';

export function NFTCard({
  nft,
  onClick,
  layout = 'grid',
}: {
  nft: NFT;
  onClick?: () => void;
  layout?: 'grid' | 'list';
}) {
  const imageUrl = nft.content.links?.image || nft.content.files?.[0]?.uri;
  const name = nft.content.metadata.name || 'Unnamed NFT';
  /**
   * The *verified* collection and nothing else. `grouping` is an on-chain
   * verified collection key; `metadata.symbol` is a free string whichever
   * account authority wrote the metadata chose, and most items have no grouping
   * at all — so falling back to the symbol here would print an airdropped
   * scam's self-declared "Mad Lads" in the field that means a verified Mad Lads
   * collection, in the same styling, under the same word. An unverified string
   * is worth less than the word "Unknown".
   */
  const collection = nft.grouping?.find((g) => g.group_key === 'collection')?.group_value || 'Unknown collection';
  const isCompressed = nft.compression?.compressed || false;

  if (layout === 'list') {
    return (
      <button
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/5"
      >
        <div className="h-12 w-12 overflow-hidden rounded-xl bg-white/5">
          {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Icon name="nft" className="h-4 w-4 text-fg-3" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg-0">{name}</p>
          <p className="truncate text-xs text-fg-2">{collection}</p>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition hover:border-brand-a/40"
    >
      <div className="relative aspect-square bg-black/40">
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="h-full w-full object-cover transition duration-slow group-hover:scale-105" />
        ) : (
          <div className="grid h-full place-items-center text-fg-3">
            <Icon name="nft" className="h-8 w-8" />
          </div>
        )}
        {isCompressed && (
          <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-fg-1">cNFT</span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <h4 className="truncate text-sm font-medium text-fg-0">{name}</h4>
        <p className="truncate text-xs text-fg-2">{collection}</p>
      </div>
    </button>
  );
}
