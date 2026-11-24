import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import jsQR from 'jsqr';
import { BellRing, Camera, ImagePlus, QrCode, Radio, Store, X } from 'lucide-react';
import { apiUrl } from '../lib/api.ts';
import { MerchantShop } from '../types.ts';
import { EASE_OUT_EXPO } from './MotionPrimitives.tsx';

interface QRScannerModalProps {
  open: boolean;
  favoriteShopIds: number[];
  onClose: () => void;
  onJoinLive: (sessionId: number, viaQr?: boolean) => void;
  onOpenShop: (shopId: number) => void;
  onToggleFavorite: (shopId: number) => void;
}

type ParsedQRTarget =
  | { type: 'shop'; shopId: number }
  | { type: 'live'; sessionId: number }
  | null;

export function parseShopQRPayload(raw: string): ParsedQRTarget {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Numeric shop ID directly
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return id > 0 ? { type: 'shop', shopId: id } : null;
  }

  // JSON payload e.g. {"shopId": 12} or {"liveSessionId": 4}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { shopId?: unknown; liveSessionId?: unknown };
      if (Number.isInteger(Number(parsed.liveSessionId)) && Number(parsed.liveSessionId) > 0) {
        return { type: 'live', sessionId: Number(parsed.liveSessionId) };
      }
      if (Number.isInteger(Number(parsed.shopId)) && Number(parsed.shopId) > 0) {
        return { type: 'shop', shopId: Number(parsed.shopId) };
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Custom scheme e.g. marchelive://shop/12 or marchelive:shop:12
  const customMatch = trimmed.match(/marchelive(?::\/\/|:)(?:shop|boutique)[/:](\d+)/i);
  if (customMatch) {
    return { type: 'shop', shopId: Number(customMatch[1]) };
  }

  // Standard URL with ?shop=12 or ?live=5 or /shop/12
  try {
    const url = new URL(trimmed, window.location.origin);
    const liveParam = Number(url.searchParams.get('live'));
    if (Number.isInteger(liveParam) && liveParam > 0) {
      return { type: 'live', sessionId: liveParam };
    }
    const shopParam = Number(url.searchParams.get('shop'));
    if (Number.isInteger(shopParam) && shopParam > 0) {
      return { type: 'shop', shopId: shopParam };
    }
    const pathMatch = url.pathname.match(/\/(?:shop|shops|boutique)\/(\d+)/i);
    if (pathMatch) {
      return { type: 'shop', shopId: Number(pathMatch[1]) };
    }
  } catch {
    // Not a URL
  }

  return null;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  open,
  favoriteShopIds,
  onClose,
  onJoinLive,
  onOpenShop,
  onToggleFavorite,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [resolvedShop, setResolvedShop] = useState<MerchantShop | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const handleDecodedString = useCallback(
    async (rawValue: string) => {
      const target = parseShopQRPayload(rawValue);
      if (!target) {
        setScanError('Code QR non reconnu comme une boutique MARCHÉ LIVE.');
        return;
      }

      stopCamera();
      setResolving(true);
      setScanError(null);

      try {
        if (target.type === 'live') {
          onClose();
          onJoinLive(target.sessionId, true);
          return;
        }

        const res = await fetch(apiUrl(`/api/shops/${target.shopId}`));
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Boutique introuvable.');
        }

        const shop = data as MerchantShop;
        if (shop.activeLive && shop.activeLive.status === 'live') {
          onClose();
          onJoinLive(shop.activeLive.id, true);
          return;
        }

        setResolvedShop(shop);
      } catch (err: unknown) {
        setScanError(err instanceof Error ? err.message : 'Erreur lecture boutique.');
      } finally {
        setResolving(false);
      }
    },
    [stopCamera, onClose, onJoinLive]
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setScanError(null);
    setResolvedShop(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Caméra non disponible sur cet appareil. Utilisez une photo de code QR ou saisissez le numéro de boutique.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);

      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts?: { formats: string[] }) => {
            detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;
      const nativeDetector = BarcodeDetectorCtor
        ? new BarcodeDetectorCtor({ formats: ['qr_code'] })
        : null;

      let lastCheck = 0;
      let handled = false;

      const scanFrame = async (ts: number) => {
        if (!streamRef.current || handled) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState >= 2 && ts - lastCheck >= 140) {
          lastCheck = ts;
          try {
            if (nativeDetector) {
              const found = await nativeDetector.detect(video);
              const val = found[0]?.rawValue;
              if (val) {
                handled = true;
                handleDecodedString(val);
                return;
              }
            } else {
              const vw = video.videoWidth;
              const vh = video.videoHeight;
              if (vw > 0 && vh > 0) {
                const scale = Math.min(1, 640 / vw);
                canvas.width = Math.round(vw * scale);
                canvas.height = Math.round(vh * scale);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                  });
                  if (code?.data) {
                    handled = true;
                    handleDecodedString(code.data);
                    return;
                  }
                }
              }
            }
          } catch {
            // Continue scanning next frame
          }
        }
        rafRef.current = window.requestAnimationFrame(scanFrame);
      };

      rafRef.current = window.requestAnimationFrame(scanFrame);
    } catch {
      setCameraError(
        'Accès caméra refusé ou indisponible. Importez une photo du code QR ou entrez le n° de boutique ci-dessous.'
      );
      stopCamera();
    }
  }, [handleDecodedString, stopCamera]);

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
      setResolvedShop(null);
      setScanError(null);
      setManualCode('');
    }
    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current || document.createElement('canvas');
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      bitmap.close();
      if (!code?.data) {
        setScanError('Aucun code QR détecté sur cette image.');
        return;
      }
      await handleDecodedString(code.data);
    } catch {
      setScanError('Impossible d’analyser cette image QR.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleDecodedString(manualCode);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="qr-scanner-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scanner le code QR d'une boutique"
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            className="w-full sm:max-w-md bg-surface border border-line rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
          >
            {/* Mobile drag handle */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full bg-line-strong" />
            </div>

            {/* Header */}
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-brand-green-text" />
                <div>
                  <h3 className="text-sm font-bold text-ink">Scanner le QR d'une boutique</h3>
                  <p className="text-[11px] text-ink-muted">
                    Rejoignez instantanément son LIVE sur le marché
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer le scanner QR"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-surface-muted cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <canvas ref={canvasRef} className="hidden" />

              {resolvedShop ? (
                <div className="bg-surface-subtle border border-line rounded-2xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-brand-green-text">
                        Boutique détectée · {resolvedShop.market?.name}
                      </div>
                      <h4 className="text-base font-extrabold text-ink mt-0.5">
                        {resolvedShop.shopName}
                      </h4>
                      <p className="text-xs text-ink-secondary mt-0.5">
                        {resolvedShop.market?.city} · Note {resolvedShop.ratingAvg}/5
                      </p>
                    </div>
                    <Store className="w-6 h-6 text-brand-green-text shrink-0" />
                  </div>

                  <div className="text-xs text-ink-muted bg-surface border border-line rounded-xl px-3 py-2">
                    Ce commerçant n'est pas en LIVE en ce moment. Consultez son catalogue ou activez les alertes pour son prochain direct.
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const id = resolvedShop.id;
                        onClose();
                        onOpenShop(id);
                      }}
                      className="w-full py-2.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-bold rounded-xl cursor-pointer"
                    >
                      Voir l'étal & commander
                    </button>
                    {!favoriteShopIds.includes(resolvedShop.id) && (
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(resolvedShop.id)}
                        className="w-full py-2.5 bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange-text text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <BellRing className="w-3.5 h-3.5" />
                        <span>M'alerter quand le LIVE démarre</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={startCamera}
                      className="w-full py-2 bg-surface-muted hover:bg-line text-ink-secondary text-xs font-semibold rounded-xl cursor-pointer"
                    >
                      Scanner un autre QR
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Camera viewport */}
                  <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-square max-h-64 w-full border border-line flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
                    />

                    {cameraActive && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-44 h-44 rounded-2xl border-2 border-[#22C55E] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative">
                          <span className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-[#EA580C] rounded-tl-md" />
                          <span className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-[#EA580C] rounded-tr-md" />
                          <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-[#EA580C] rounded-bl-md" />
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-[#EA580C] rounded-br-md" />
                        </div>
                      </div>
                    )}

                    {!cameraActive && (
                      <div className="absolute inset-0 p-5 flex flex-col items-center justify-center text-center text-white space-y-2.5">
                        <Camera className="w-8 h-8 text-[#EA580C]" />
                        <p className="text-xs text-slate-200 max-w-xs">
                          {cameraError || 'Initialisation de la caméra...'}
                        </p>
                        {cameraError && (
                          <button
                            type="button"
                            onClick={startCamera}
                            className="px-3.5 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
                          >
                            Réessayer la caméra
                          </button>
                        )}
                      </div>
                    )}

                    {resolving && (
                      <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white text-xs font-semibold gap-2">
                        <Radio className="w-6 h-6 text-red-500 animate-pulse" />
                        <span>Connexion à la boutique...</span>
                      </div>
                    )}
                  </div>

                  {scanError && (
                    <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs px-3.5 py-2.5 rounded-xl">
                      {scanError}
                    </div>
                  )}

                  {/* Image fallback & manual shop code */}
                  <div className="space-y-3 pt-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2.5 px-4 bg-surface-muted hover:bg-line text-ink text-xs font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ImagePlus className="w-4 h-4 text-brand-green-text" />
                      <span>Importer une photo de code QR</span>
                    </button>

                    <form onSubmit={handleManualSubmit} className="flex gap-2">
                      <input
                        type="text"
                        value={manualCode}
                        onChange={(e) => setManualCode(e.target.value)}
                        placeholder="Ou saisir le n° boutique / lien (ex: 1)"
                        aria-label="Numéro ou lien de la boutique"
                        className="flex-1 px-3 py-2 text-xs border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
                      />
                      <button
                        type="submit"
                        disabled={resolving || !manualCode.trim()}
                        className="px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        Ouvrir
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
