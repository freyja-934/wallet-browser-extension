import QRCode from 'qrcode';
import React from 'react';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

interface ReceiveCardProps {
  address: string;
  tokenSymbol: string;
}

export function ReceiveCard({ address, tokenSymbol }: ReceiveCardProps) {
  const [qrDataUrl, setQrDataUrl] = React.useState('');

  React.useEffect(() => {
    QRCode.toDataURL(address, {
      width: 200,
      margin: 2,
      color: {
        dark: '#111214',
        light: '#FFFFFF'
      }
    }).then(setQrDataUrl);
  }, [address]);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    // TODO: Show toast
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `Receive ${tokenSymbol}`,
        text: `My ${tokenSymbol} address: ${address}`
      });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className="text-sm text-fg-1">Receive {tokenSymbol}</h3>
        
        <div className="grid place-items-center py-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="rounded-lg" />
          ) : (
            <div className="h-[200px] w-[200px] rounded-lg bg-bg-2 animate-pulse" />
          )}
        </div>
        
        <code className="block text-center text-xs text-fg-2 font-mono">
          {formatAddress(address)}
        </code>
        
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton onClick={handleCopy}>
            Copy
          </SecondaryButton>
          <PrimaryButton onClick={handleShare}>
            Share
          </PrimaryButton>
        </div>
        
        <p className="text-xs text-fg-3 text-center">
          Solana network only. Sending other assets to this address can result in loss of funds.
        </p>
      </CardContent>
    </Card>
  );
}
