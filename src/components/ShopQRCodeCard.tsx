import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, QrCode } from 'lucide-react';

interface ShopQRCodeCardProps {
  shopId: number;
  shopName: string;
  marketName?: string;
}

export const ShopQRCodeCard: React.FC<ShopQRCodeCardProps> = ({
  shopId,
  shopName,
  marketName,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?shop=${shopId}`
      : `/?shop=${shopId}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#0F5132',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [shareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-5">
      <div className="bg-white p-2.5 rounded-xl border border-line shrink-0">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`Code QR de la boutique ${shopName}`}
            className="w-28 h-28 object-contain"
          />
        ) : (
          <div className="w-28 h-28 flex items-center justify-center text-slate-400">
            <QrCode className="w-10 h-10" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-brand-green-text">
          <QrCode className="w-4 h-4" />
          <span>Code QR de votre étal · Boutique #{shopId}</span>
        </div>
        <h3 className="text-sm font-bold text-ink truncate">{shopName}</h3>
        <p className="text-xs text-ink-secondary">
          Affichez ce code QR sur votre étal{marketName ? ` (${marketName})` : ''} : vos clients le scannent pour rejoindre votre LIVE instantanément.
        </p>

        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
          {qrDataUrl && (
            <a
              href={qrDataUrl}
              download={`marche-live-qr-boutique-${shopId}.png`}
              className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Télécharger PNG</span>
            </a>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1.5 bg-surface-muted hover:bg-line text-ink text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-brand-green-text" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copied ? 'Lien copié' : 'Copier le lien'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
