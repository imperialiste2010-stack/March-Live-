import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  QrCode,
  Share,
  Share2,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/` : 'https://marchelive.ci/';

  useEffect(() => {
    if (!showModal) return;
    let active = true;
    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#0F5132', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [showModal, shareUrl]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard errors
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'MARCHÉ LIVE — Application Marchands & Clients',
          text: 'Installez l’application MARCHÉ LIVE sur votre téléphone pour vendre et acheter en direct sur les marchés de Côte d’Ivoire :',
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyLink();
  };

  const whatsappText = encodeURIComponent(
    `Bonjour ! Installez l'application MARCHÉ LIVE sur votre téléphone pour diffuser vos produits en direct et recevoir vos paiements Mobile Money : ${shareUrl}`
  );

  if (isInstalled) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title="Partager l'application aux commerçants"
          aria-label="Partager l'application MARCHÉ LIVE"
          className="h-10 px-2.5 sm:px-3 rounded-xl border border-line bg-surface-subtle hover:bg-surface-muted text-ink flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share2 className="w-4 h-4 text-brand-green-text" />
          <span className="hidden lg:inline">Partager</span>
        </button>

        {showModal && (
          <InstallAndShareModal
            isInstallable={isInstallable}
            isInstalled={isInstalled}
            isIOS={isIOS}
            shareUrl={shareUrl}
            qrDataUrl={qrDataUrl}
            copied={copied}
            whatsappText={whatsappText}
            onInstall={install}
            onCopy={handleCopyLink}
            onShare={handleNativeShare}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isInstallable) {
            void install();
          } else {
            setShowModal(true);
          }
        }}
        title="Installer sur mobile et partager aux commerçants"
        aria-label="Installer l'application MARCHÉ LIVE"
        className="h-10 px-2.5 sm:px-3 rounded-xl border border-brand-green/50 bg-surface-subtle hover:bg-surface-muted text-brand-green-text flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        {isIOS ? <Smartphone className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        <span className="hidden lg:inline">{isIOS ? 'App iPhone' : 'Installer l’app'}</span>
      </button>

      {showModal && (
        <InstallAndShareModal
          isInstallable={isInstallable}
          isInstalled={isInstalled}
          isIOS={isIOS}
          shareUrl={shareUrl}
          qrDataUrl={qrDataUrl}
          copied={copied}
          whatsappText={whatsappText}
          onInstall={install}
          onCopy={handleCopyLink}
          onShare={handleNativeShare}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
};

interface InstallAndShareModalProps {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  shareUrl: string;
  qrDataUrl: string | null;
  copied: boolean;
  whatsappText: string;
  onInstall: () => Promise<boolean>;
  onCopy: () => Promise<void>;
  onShare: () => Promise<void>;
  onClose: () => void;
}

const InstallAndShareModal: React.FC<InstallAndShareModalProps> = ({
  isInstallable,
  isInstalled,
  isIOS,
  shareUrl,
  qrDataUrl,
  copied,
  whatsappText,
  onInstall,
  onCopy,
  onShare,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-line p-6 shadow-xl space-y-5 my-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-ink">
              Installer sur mobile & donner aux commerçants
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              MARCHÉ LIVE s’installe directement sur Android et iPhone sans passer par un store.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section 1: Install on current device */}
        {!isInstalled && (
          <div className="bg-surface-subtle border border-line rounded-xl p-4 space-y-3">
            <div className="text-xs font-bold text-ink flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-brand-green-text" />
              <span>1. Installer sur votre téléphone</span>
            </div>

            {isInstallable ? (
              <button
                type="button"
                onClick={() => void onInstall()}
                className="w-full py-2.5 rounded-xl bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Installer maintenant sur cet appareil</span>
              </button>
            ) : isIOS ? (
              <ol className="space-y-2 text-xs text-ink-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-brand-green-text">1.</span>
                  <span>
                    Dans Safari, appuyez sur <strong className="text-ink inline-flex items-center gap-1">Partager <Share className="w-3.5 h-3.5" /></strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-brand-green-text">2.</span>
                  <span>
                    Choisissez <strong className="text-ink">Sur l’écran d’accueil</strong> puis <strong className="text-ink">Ajouter</strong>.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-2 text-xs text-ink-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-brand-green-text">1.</span>
                  <span>
                    Ouvrez cette page dans <strong className="text-ink">Google Chrome</strong> (Android) ou <strong className="text-ink">Safari</strong> (iPhone).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-brand-green-text">2.</span>
                  <span>
                    Sur Android : menu <strong className="text-ink">⋮ → Installer l’application</strong> (ou « Ajouter à l’écran d’accueil »).
                  </span>
                </li>
              </ol>
            )}
          </div>
        )}

        {/* Section 2: Share with merchants */}
        <div className="bg-surface-subtle border border-line rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold text-ink flex items-center gap-2">
            <QrCode className="w-4 h-4 text-brand-orange-text" />
            <span>2. Donner l’application aux commerçants</span>
          </div>
          <p className="text-xs text-ink-secondary leading-relaxed">
            Faites scanner ce code QR au commerçant avec la caméra de son téléphone, ou envoyez-lui le lien directement sur WhatsApp :
          </p>

          {qrDataUrl && (
            <div className="flex justify-center py-1">
              <div className="bg-white p-2.5 rounded-xl border border-line shadow-xs">
                <img
                  src={qrDataUrl}
                  alt="QR Code d'installation MARCHÉ LIVE"
                  className="w-36 h-36 block"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 bg-surface border border-line rounded-lg px-2.5 py-2">
            <span className="text-[11px] font-mono text-ink-secondary truncate flex-1">
              {shareUrl}
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="px-2.5 py-1 rounded-md bg-surface-muted hover:bg-line text-ink text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-brand-green-text" />
                  <span>Copié</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copier</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={`https://wa.me/?text=${whatsappText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold text-center whitespace-nowrap"
            >
              Envoyer via WhatsApp
            </a>
            <button
              type="button"
              onClick={onShare}
              className="py-2.5 px-3 rounded-xl bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Partager</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-muted text-ink text-xs font-semibold cursor-pointer"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode hors ligne — Données en cache affichées</span>
    </div>
  );
};
