import { useMemo } from 'react';
import { useCollectibleImage } from '../../hooks/useWalletQueries';
import type { Collectible } from '../../services/collectibles';
import type { NFT } from '../../store/slices/walletSlice';
import { NFTCard } from './NFTCard';

/** A collectible with no name of its own is shown by its mint, never by a placeholder. */
export function collectibleLabel(item: Collectible): string {
  return item.name ?? `${item.mint.slice(0, 4)}…${item.mint.slice(-4)}`;
}

/**
 * A keyless collectible in the shape the card and the detail modal already read.
 * No `ownership` and no `compression`: the keyless path reads a mint account and
 * a metadata account, and neither of those says anything about either.
 */
export function collectibleAsNft(item: Collectible, image?: string): NFT {
  return {
    id: item.mint,
    content: {
      metadata: { name: collectibleLabel(item), symbol: item.symbol ?? '' },
      ...(image !== undefined ? { links: { image } } : {}),
    },
  };
}

/**
 * One keyless collectible, and the only place its picture is asked for.
 *
 * The card is what fetches — not the list, and not the balances query — so the
 * off-chain document at whatever host the creator chose is requested for the
 * items on screen and for nothing else. While it is in flight, or if it never
 * arrives, the card renders exactly as it does for an item with no picture at
 * all.
 */
export function CollectibleCard({
  item,
  layout,
  onSelect,
}: {
  item: Collectible;
  layout: 'grid' | 'list';
  onSelect: (nft: NFT) => void;
}) {
  const { data: image } = useCollectibleImage(item.uri);
  const nft = useMemo(() => collectibleAsNft(item, image ?? undefined), [item, image]);
  return <NFTCard nft={nft} layout={layout} onClick={() => onSelect(nft)} />;
}
