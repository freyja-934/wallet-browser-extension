import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AddressText, Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';

export function ReceiveCard({ address }: { address: string }) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(address, {
      width: 200,
      margin: 2,
      color: { dark: '#010000', light: '#ebeae9' },
    }).then(setQrDataUrl);
  }, [address]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    toast.success('Address copied');
  };

  const canShare = typeof navigator.share === 'function';

  return (
    <div className="space-y-4">
      <div className="grid place-items-center py-2">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Receive QR code" className="rounded-2xl" />
        ) : (
          <div className="h-[200px] w-[200px] animate-pulse rounded-2xl bg-white/5" />
        )}
      </div>

      <div className="rounded-2xl bg-white/5 px-3 py-3 text-center">
        <AddressText address={address} truncate={false} />
      </div>

      <div className={`grid gap-3 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <SecondaryButton onClick={handleCopy} data-testid="receive-copy">
          Copy
        </SecondaryButton>
        {canShare && (
          <PrimaryButton
            onClick={() => {
              navigator.share({ title: 'Cinder Wallet address', text: address });
            }}
          >
            Share
          </PrimaryButton>
        )}
      </div>

      <Banner>Solana network only. Sending other assets to this address can result in loss of funds.</Banner>
    </div>
  );
}
