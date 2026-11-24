import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Camera,
  Check,
  ClipboardList,
  Eye,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  RefreshCw,
  Send,
  ShoppingBasket,
  Trash2,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiUrl, wsUrl } from '../lib/api.ts';
import { auth } from '../lib/firebase.ts';
import {
  CartItem,
  LiveMessage,
  LiveSession,
  MerchantShop,
  Product,
  ShoppingListItem,
} from '../types.ts';
import { EASE_OUT_EXPO } from './MotionPrimitives.tsx';
import { LiveRoomSkeleton } from './Skeletons.tsx';

function normalizeProductText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function findMatchingCatalogProduct(
  itemName: string,
  catalog: Product[]
): Product | undefined {
  const normItem = normalizeProductText(itemName);
  if (!normItem) return undefined;
  const available = catalog.filter((p) => p.isAvailable);

  const direct = available.find((p) => {
    const normProd = normalizeProductText(p.name);
    return normProd.includes(normItem) || normItem.includes(normProd);
  });
  if (direct) return direct;

  const words = normItem.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return undefined;
  return available.find((p) => {
    const normProd = normalizeProductText(p.name);
    return words.every((w) => normProd.includes(w));
  });
}

interface LiveRoomProps {
  sessionId: number;
  isHostMode?: boolean;
  joinedViaQr?: boolean;
  diasporaConfig?: {
    enabled: boolean;
    beneficiaryName: string;
    beneficiaryPhone: string;
    city: string;
    commune: string;
    quartier: string;
    address: string;
    message: string;
    currency: string;
    fxRate: number;
  } | null;
  onClose: () => void;
  onOrderCreated: (orderId: number) => void;
}

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export const LiveRoom: React.FC<LiveRoomProps> = ({
  sessionId,
  isHostMode = false,
  joinedViaQr = false,
  diasporaConfig,
  onClose,
  onOrderCreated,
}) => {
  const { dbUser, customerProfile, signIn, apiFetch } = useAuth();

  const [sessionData, setSessionData] = useState<
    (LiveSession & { shop: MerchantShop; products: Product[]; messages: LiveMessage[] }) | null
  >(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [reactions, setReactions] = useState<Array<{ id: string; emoji: string; senderName: string }>>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [subtotalXof, setSubtotalXof] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat & product selection states
  const [chatText, setChatText] = useState('');
  const [selectedQty, setSelectedQty] = useState<Record<number, number>>({});
  const [addingProductId, setAddingProductId] = useState<number | null>(null);
  const [addingListItemId, setAddingListItemId] = useState<string | null>(null);
  const [addingAllMatched, setAddingAllMatched] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  // Delivery checkout address
  const [deliveryCity, setDeliveryCity] = useState(
    diasporaConfig?.enabled ? diasporaConfig.city : customerProfile?.city || 'Abidjan'
  );
  const [deliveryCommune, setDeliveryCommune] = useState(
    diasporaConfig?.enabled ? diasporaConfig.commune : customerProfile?.commune || 'Cocody'
  );
  const [deliveryAddress, setDeliveryAddress] = useState(
    diasporaConfig?.enabled
      ? `${diasporaConfig.quartier ? diasporaConfig.quartier + ', ' : ''}${diasporaConfig.address}`
      : customerProfile?.addressLabel || ''
  );

  // WebRTC & Camera states
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [videoQuality, setVideoQuality] = useState<'eco_3g' | 'auto_3g_4g' | 'hd_4g'>('auto_3g_4g');
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/lives/${sessionId}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Session introuvable');
      setSessionData(data);
      setMessages(data.messages || []);
      setViewerCount(data.viewerCount || 0);
      setCameraFacing(data.cameraFacing || 'environment');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement du LIVE');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadCart = useCallback(
    async (shopId: number) => {
      if (!dbUser) return;
      try {
        const data = await apiFetch<{ items: CartItem[]; subtotalXof: number }>(
          `/api/carts/${shopId}`
        );
        setCartItems(data.items || []);
        setSubtotalXof(data.subtotalXof || 0);
      } catch {
        // Ignore unauthenticated cart fetch
      }
    },
    [dbUser, apiFetch]
  );

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (sessionData?.shop?.id && dbUser) {
      loadCart(sessionData.shop.id);
    }
  }, [sessionData?.shop?.id, dbUser, loadCart]);

  // Start local camera stream if host
  const startHostMedia = useCallback(
    async (facing: 'environment' | 'user', quality: 'eco_3g' | 'auto_3g_4g' | 'hd_4g') => {
      try {
        setMediaError(null);
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        const constraintsMap = {
          eco_3g: { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } },
          auto_3g_4g: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
          hd_4g: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, ...constraintsMap[quality] },
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        // Replace tracks on active peer connections
        Object.values(peerConnectionsRef.current).forEach((pc) => {
          stream.getTracks().forEach((track) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track);
            } else {
              pc.addTrack(track, stream);
            }
          });
        });
      } catch {
        setMediaError(
          'Caméra ou microphone non autorisé sur cet appareil. Vérifiez les permissions du navigateur.'
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!isHostMode) return;
    startHostMedia(cameraFacing, videoQuality);
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isHostMode, cameraFacing, videoQuality, startHostMedia]);

  // WebSocket + WebRTC signaling lifecycle
  useEffect(() => {
    if (!sessionData) return;

    const ws = new WebSocket(wsUrl('/ws'));
    wsRef.current = ws;

    const createPeer = (remoteClientId: string) => {
      if (peerConnectionsRef.current[remoteClientId]) {
        return peerConnectionsRef.current[remoteClientId];
      }
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionsRef.current[remoteClientId] = pc;

      if (isHostMode && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.ontrack = (ev) => {
        if (remoteVideoRef.current && ev.streams[0]) {
          remoteVideoRef.current.srcObject = ev.streams[0];
          setHasRemoteStream(true);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              event: 'rtc:ice-candidate',
              payload: {
                sessionId,
                targetClientId: remoteClientId,
                candidate: ev.candidate,
              },
            })
          );
        }
      };

      return pc;
    };

    ws.onopen = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        ws.send(JSON.stringify({ event: 'auth', payload: { token } }));
      }
      ws.send(
        JSON.stringify({
          event: 'live:join',
          payload: {
            sessionId,
            shopId: sessionData.shopId,
            role: isHostMode ? 'host' : 'viewer',
          },
        })
      );
    };

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const { event, payload } = msg;

        if (event === 'live:presence') {
          setViewerCount(payload.viewerCount ?? 0);
          // Host creates WebRTC offer for newly joined viewer
          if (isHostMode && payload.joinedClientId && payload.role === 'viewer') {
            const pc = createPeer(payload.joinedClientId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(
              JSON.stringify({
                event: 'rtc:offer',
                payload: {
                  sessionId,
                  targetClientId: payload.joinedClientId,
                  sdp: offer,
                },
              })
            );
          }
        }

        if (event === 'rtc:offer' && !isHostMode && payload.fromClientId) {
          const pc = createPeer(payload.fromClientId);
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              event: 'rtc:answer',
              payload: {
                sessionId,
                targetClientId: payload.fromClientId,
                sdp: answer,
              },
            })
          );
        }

        if (event === 'rtc:answer' && isHostMode && payload.fromClientId) {
          const pc = peerConnectionsRef.current[payload.fromClientId];
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          }
        }

        if (event === 'rtc:ice-candidate' && payload.fromClientId && payload.candidate) {
          const pc = peerConnectionsRef.current[payload.fromClientId];
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          }
        }

        if (event === 'live:message') {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.id)) return prev;
            return [...prev, payload];
          });
        }

        if (
          event === 'cart:updated' ||
          event === 'cart:price_proposed' ||
          event === 'cart:price_responded'
        ) {
          if (sessionData?.shopId) {
            loadCart(sessionData.shopId);
          }
        }

        if (event === 'live:ended') {
          setSessionData((prev) => (prev ? { ...prev, status: 'ended' } : prev));
        }

        if (event === 'live:reaction' && payload?.emoji) {
          const item = {
            id: String(payload.id || Date.now()),
            emoji: String(payload.emoji),
            senderName: String(payload.senderName || 'Client'),
          };
          setReactions((prev) => [...prev.slice(-10), item]);
          window.setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== item.id));
          }, 2200);
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'live:leave', payload: { sessionId } }));
      }
      ws.close();
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};
    };
  }, [sessionData?.id, sessionData?.shopId, sessionId, isHostMode, loadCart]);

  const sendReaction = (emoji: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: 'live:reaction',
          payload: { emoji },
        })
      );
    }
  };

  const sendMessage = (type: 'chat' | 'product_request', textOverride?: string) => {
    const content = (textOverride ?? chatText).trim();
    if (!content) return;
    if (!dbUser) {
      signIn();
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: type === 'product_request' ? 'live:product_request' : 'live:chat',
          payload: { content },
        })
      );
      if (!textOverride) setChatText('');
    }
  };

  const handleAddToCart = async (product: Product) => {
    if (!dbUser) {
      await signIn();
      return;
    }
    const qty = selectedQty[product.id] || 1;
    setAddingProductId(product.id);
    try {
      await apiFetch(`/api/carts/${product.shopId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          quantityOrWeight: qty,
          liveSessionId: sessionId,
          customerConfirmed: true,
        }),
      });
      await loadCart(product.shopId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout panier');
    } finally {
      setAddingProductId(null);
    }
  };

  const handleQuickAddShoppingItem = async (item: ShoppingListItem, product: Product) => {
    if (!dbUser) {
      await signIn();
      return;
    }
    setAddingListItemId(item.id);
    setError(null);
    try {
      await apiFetch(`/api/carts/${product.shopId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          quantityOrWeight: item.defaultQty > 0 ? item.defaultQty : 1,
          notes: item.notes,
          liveSessionId: sessionId,
          customerConfirmed: true,
        }),
      });
      await loadCart(product.shopId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout rapide au panier');
    } finally {
      setAddingListItemId(null);
    }
  };

  const handleAddAllMatchedShoppingItems = async (
    pairs: Array<{ item: ShoppingListItem; product: Product }>
  ) => {
    if (!dbUser || pairs.length === 0 || !sessionData) return;
    setAddingAllMatched(true);
    setError(null);
    try {
      for (const { item, product } of pairs) {
        await apiFetch(`/api/carts/${product.shopId}/items`, {
          method: 'POST',
          body: JSON.stringify({
            productId: product.id,
            quantityOrWeight: item.defaultQty > 0 ? item.defaultQty : 1,
            notes: item.notes,
            liveSessionId: sessionId,
            customerConfirmed: true,
          }),
        });
      }
      await loadCart(sessionData.shopId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout groupé au panier');
    } finally {
      setAddingAllMatched(false);
    }
  };

  const handleRespondPrice = async (itemId: number, approve: boolean) => {
    try {
      await apiFetch(`/api/cart-items/${itemId}/respond-price`, {
        method: 'PATCH',
        body: JSON.stringify({ approve }),
      });
      if (sessionData) await loadCart(sessionData.shopId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur validation prix');
    }
  };

  const handleRemoveCartItem = async (itemId: number) => {
    try {
      await apiFetch(`/api/cart-items/${itemId}`, { method: 'DELETE' });
      if (sessionData) await loadCart(sessionData.shopId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  };

  const handleCreateOrder = async () => {
    if (!sessionData) return;
    if (!deliveryAddress.trim()) {
      setError('Veuillez saisir votre quartier / adresse de livraison précise.');
      return;
    }
    setCheckingOut(true);
    setError(null);
    try {
      const order = await apiFetch<{ id: number }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          shopId: sessionData.shopId,
          deliveryCity,
          deliveryCommune,
          deliveryAddress,
          deliveryLat: customerProfile?.lat ?? undefined,
          deliveryLng: customerProfile?.lng ?? undefined,
          isDiasporaOrder: Boolean(diasporaConfig?.enabled),
          beneficiaryName: diasporaConfig?.beneficiaryName,
          beneficiaryPhone: diasporaConfig?.beneficiaryPhone,
          diasporaMessage: diasporaConfig?.message,
          displayCurrency: diasporaConfig?.currency || 'XOF',
          fxRateApplied: diasporaConfig?.fxRate || 1,
        }),
      });
      onOrderCreated(order.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la commande');
    } finally {
      setCheckingOut(false);
    }
  };

  const handleSwitchCamera = async () => {
    const next = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(next);
    await apiFetch(`/api/lives/${sessionId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ cameraFacing: next }),
    }).catch(() => {});
  };

  const handleEndLive = async () => {
    try {
      await apiFetch(`/api/lives/${sessionId}/end`, { method: 'POST' });
    } finally {
      onClose();
    }
  };

  const toggleMic = () => {
    const audioTracks = localStreamRef.current?.getAudioTracks() || [];
    audioTracks.forEach((t) => {
      t.enabled = micMuted;
    });
    setMicMuted(!micMuted);
  };

  const toggleCam = () => {
    const videoTracks = localStreamRef.current?.getVideoTracks() || [];
    videoTracks.forEach((t) => {
      t.enabled = camOff;
    });
    setCamOff(!camOff);
  };

  const hasPendingPriceProposal = cartItems.some(
    (i) => i.priceProposalStatus === 'pending_customer_approval'
  );

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="live-skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <LiveRoomSkeleton />
        </motion.div>
      ) : !sessionData ? (
        <motion.div
          key="live-error"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          className="bg-surface border border-line rounded-2xl p-8 text-center"
        >
          <p className="text-sm text-red-600 dark:text-red-400">{error || 'Session LIVE introuvable.'}</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-ink text-canvas text-sm font-semibold rounded-lg cursor-pointer"
          >
            Retour aux marchés
          </button>
        </motion.div>
      ) : (
        <motion.div
          key={`live-room-${sessionData.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="space-y-6"
        >
      {/* Top LIVE control bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface border border-line rounded-2xl px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-secondary">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-red-600 text-white font-bold rounded text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {sessionData.status === 'live' ? 'LIVE' : 'TERMINÉ'}
            </span>
            <span>{sessionData.shop.shopName}</span>
            <span aria-hidden="true">·</span>
            <span>{sessionData.shop.market?.name}</span>
          </div>
          <h2 className="text-xl font-bold text-ink mt-1">{sessionData.title}</h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm font-mono font-semibold text-ink-secondary tabular-nums px-3 py-1.5 bg-surface-muted rounded-lg">
            <Eye className="w-4 h-4 text-brand-green-text" />
            <span>{viewerCount} spectateur{viewerCount > 1 ? 's' : ''}</span>
          </div>
          {isHostMode ? (
            <button
              onClick={handleEndLive}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Arrêter le LIVE</span>
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-ink hover:opacity-90 text-canvas text-sm font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Quitter le LIVE</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-700 dark:text-red-300 font-semibold cursor-pointer">
            Fermer
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Video Feed + Interactive Chat */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative bg-slate-950 rounded-2xl overflow-hidden aspect-video border border-slate-800">
            {isHostMode ? (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            )}

            {!isHostMode && !hasRemoteStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-900/90 text-white">
                <Video className="w-10 h-10 text-[#EA580C] mb-3" />
                <p className="text-base font-semibold">
                  Flux vidéo WebRTC connecté — en attente de la caméra du commerçant
                </p>
                <p className="text-xs text-slate-300 mt-1 max-w-md">
                  Le commerçant diffuse en direct depuis son smartphone. Vous pouvez déjà poser vos questions ou sélectionner des produits dans son étal ci-contre.
                </p>
              </div>
            )}

            {mediaError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 text-white p-6 text-center text-sm">
                {mediaError}
              </div>
            )}

            {/* Floating Live Reactions */}
            <div className="pointer-events-none absolute bottom-14 right-3 flex flex-col items-end gap-1.5 z-10">
              <AnimatePresence>
                {reactions.map((r) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 12, scale: 0.85 }}
                    animate={{ opacity: 1, y: -12, scale: 1 }}
                    exit={{ opacity: 0, y: -36, scale: 0.9 }}
                    transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
                    className="px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-sm text-white text-xs flex items-center gap-1.5 shadow"
                  >
                    <span>{r.emoji}</span>
                    <span className="text-[10px] text-slate-200 max-w-[90px] truncate">
                      {r.senderName}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Host camera controls */}
            {isHostMode && (
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 bg-black/70 backdrop-blur-sm px-3 py-2 rounded-xl text-white">
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleMic}
                    className="p-2 rounded-lg bg-white/15 hover:bg-white/25 cursor-pointer"
                    title="Couper / Activer le micro"
                  >
                    {micMuted ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={toggleCam}
                    className="p-2 rounded-lg bg-white/15 hover:bg-white/25 cursor-pointer"
                    title="Couper / Activer la caméra"
                  >
                    {camOff ? <VideoOff className="w-4 h-4 text-red-400" /> : <Video className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleSwitchCamera}
                    className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{cameraFacing === 'environment' ? 'Caméra arrière' : 'Caméra avant'}</span>
                  </button>
                </div>
                <select
                  value={videoQuality}
                  onChange={(e) => setVideoQuality(e.target.value as 'eco_3g' | 'auto_3g_4g' | 'hd_4g')}
                  className="bg-slate-900 border border-white/20 rounded-lg px-2.5 py-1 text-xs text-white"
                  aria-label="Qualité vidéo réseau 3G/4G"
                >
                  <option value="eco_3g">Éco 3G (360p)</option>
                  <option value="auto_3g_4g">Auto 3G/4G (480p)</option>
                  <option value="hd_4g">HD 4G (720p)</option>
                </select>
              </div>
            )}
          </div>

          {/* Interactive Live Chat & Camera Product Requests */}
          <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
            {joinedViaQr && !isHostMode && (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200 font-medium">
                Connecté via le QR code de la boutique — interagissez en direct avec le commerçant.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MessageSquare className="w-4 h-4 text-brand-green-text" />
                <span>Interactions en direct</span>
              </div>
              {!isHostMode && (
                <div className="flex items-center gap-1">
                  {['👋', '❤️', '👏', '🔥'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => sendReaction(emoji)}
                      aria-label={`Réagir avec ${emoji}`}
                      className="min-h-[36px] min-w-[36px] px-2 py-1 rounded-lg bg-surface-subtle hover:bg-surface-muted border border-line text-sm transition-transform active:scale-90 cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!isHostMode && (
              <div className="flex flex-wrap gap-1.5">
                {[
                  '👋 Je suis devant votre étal',
                  'Montrez-moi de plus près',
                  'Montrez un autre lot',
                  'Quel est le poids exact ?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage('product_request', prompt)}
                    className="text-xs px-2.5 py-1.5 bg-surface-muted hover:bg-brand-orange/15 hover:text-brand-orange-text text-ink-secondary rounded-lg transition-colors cursor-pointer"
                  >
                    <Camera className="w-3 h-3 inline mr-1" />
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            <div className="h-44 overflow-y-auto space-y-2 pr-1 border-y border-line py-2">
              {messages.length === 0 ? (
                <p className="text-xs text-ink-muted text-center py-8">
                  Aucun message pour l'instant. Posez une question au commerçant pour voir un produit !
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`text-sm px-3 py-2 rounded-xl ${
                      m.messageType === 'product_request'
                        ? 'bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 text-orange-950 dark:text-orange-200'
                        : 'bg-surface-subtle text-ink'
                    }`}
                  >
                    <span className="font-semibold text-xs text-brand-green-text mr-2">
                      {m.senderName}
                    </span>
                    <span>{m.content}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendMessage('chat');
                }}
                placeholder={
                  dbUser
                    ? 'Écrire un message ou demander un produit à la caméra...'
                    : 'Connectez-vous pour discuter en direct'
                }
                className="flex-1 px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-green"
              />
              <button
                onClick={() => sendMessage('chat')}
                className="px-4 py-2.5 bg-brand-green hover:bg-brand-green-hover text-white rounded-xl text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Envoyer</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Shopping List Quick-Add + Live Product Selection + Real-Time Cart */}
        <div className="lg:col-span-5 space-y-4">
          {/* Shopping List Quick-Add (for signed-in buyers) */}
          {!isHostMode && dbUser && (() => {
            const shoppingItems = customerProfile?.shoppingList || [];
            const matchedPairs = shoppingItems
              .map((item) => ({
                item,
                product: findMatchingCatalogProduct(item.productName, sessionData.products),
              }))
              .filter(
                (entry): entry is { item: ShoppingListItem; product: Product } =>
                  Boolean(entry.product)
              );

            return (
              <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-brand-green-text" />
                    <h3 className="text-sm font-bold text-ink">
                      Ma liste de courses ({shoppingItems.length})
                    </h3>
                  </div>
                  {matchedPairs.length >= 2 && (
                    <button
                      type="button"
                      disabled={addingAllMatched}
                      onClick={() => handleAddAllMatchedShoppingItems(matchedPairs)}
                      className="px-2.5 py-1 bg-brand-green hover:bg-brand-green-hover text-white text-[11px] font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {addingAllMatched
                        ? 'Ajout...'
                        : `Tout ajouter (${matchedPairs.length})`}
                    </button>
                  )}
                </div>

                {shoppingItems.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    Pré-enregistrez vos achats habituels dans votre Profil pour les ajouter en un clic pendant un LIVE.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {shoppingItems.map((item) => {
                      const matched = findMatchingCatalogProduct(
                        item.productName,
                        sessionData.products
                      );
                      const inCart = matched
                        ? cartItems.some((ci) => ci.productId === matched.id)
                        : false;

                      return (
                        <div
                          key={item.id}
                          className="p-2.5 rounded-xl border border-line bg-surface-subtle flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-ink truncate">
                                {item.productName}
                              </span>
                              <span className="text-[11px] font-mono text-ink-muted shrink-0">
                                · {item.defaultQty} {item.unitLabel}
                              </span>
                            </div>
                            {matched ? (
                              <div className="text-[11px] text-brand-green-text truncate">
                                Étal : {matched.name} ({matched.unitPriceXof.toLocaleString('fr-FR')} FCFA)
                                {inCart ? ' · Au panier' : ''}
                              </div>
                            ) : (
                              <div className="text-[11px] text-ink-muted truncate">
                                {item.notes || 'Non listé dans le catalogue de cet étal'}
                              </div>
                            )}
                          </div>

                          {matched ? (
                            <button
                              type="button"
                              disabled={addingListItemId === item.id || addingAllMatched}
                              onClick={() => handleQuickAddShoppingItem(item, matched)}
                              className="px-2.5 py-1.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-[11px] font-semibold rounded-lg flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <Plus className="w-3 h-3" />
                              <span>
                                {addingListItemId === item.id
                                  ? '...'
                                  : `Ajouter (${item.defaultQty})`}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                sendMessage(
                                  'product_request',
                                  `Liste de courses : avez-vous "${item.productName}" (${item.defaultQty} ${item.unitLabel})${item.notes ? ` — ${item.notes}` : ''} ?`
                                )
                              }
                              className="px-2.5 py-1.5 bg-surface border border-line-strong hover:border-brand-orange text-ink-secondary hover:text-brand-orange-text text-[11px] font-semibold rounded-lg shrink-0 cursor-pointer"
                            >
                              Demander en direct
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Catalog Selection */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="text-base font-bold text-ink mb-3">
              Produits présentés ({sessionData.products.length})
            </h3>
            {sessionData.products.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Ce commerçant n'a pas encore ajouté d'articles à son catalogue.
              </p>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {sessionData.products.map((prod) => (
                  <div
                    key={prod.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-surface-subtle"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-ink truncate">
                        {prod.name}
                      </div>
                      <div className="text-xs text-ink-secondary font-mono tabular-nums mt-0.5">
                        {prod.unitPriceXof.toLocaleString('fr-FR')} FCFA / {prod.unitLabel}
                      </div>
                    </div>
                    {!isHostMode && (
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={selectedQty[prod.id] ?? 1}
                          onChange={(e) =>
                            setSelectedQty((prev) => ({
                              ...prev,
                              [prod.id]: Math.max(0.5, Number(e.target.value)),
                            }))
                          }
                          className="w-16 px-2 py-1.5 text-xs font-mono border border-line rounded-lg bg-surface text-ink text-center"
                          aria-label={`Quantité ${prod.name}`}
                        />
                        <button
                          disabled={addingProductId === prod.id}
                          onClick={() => handleAddToCart(prod)}
                          className="px-3 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          {addingProductId === prod.id ? '...' : 'Confirmer'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Real-time Interactive Cart */}
          {!isHostMode && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-ink">
                  <ShoppingBasket className="w-5 h-5 text-brand-orange-text" />
                  <span>Panier en temps réel</span>
                </div>
                <span className="font-mono text-sm font-bold text-brand-green-text tabular-nums">
                  {subtotalXof.toLocaleString('fr-FR')} FCFA
                </span>
              </div>

              {!dbUser ? (
                <button
                  onClick={signIn}
                  className="w-full py-2.5 bg-brand-green hover:bg-brand-green-hover text-white text-sm font-semibold rounded-xl cursor-pointer"
                >
                  Connectez-vous pour commander en direct
                </button>
              ) : cartItems.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  Sélectionnez vos marchandises ci-dessus avec la quantité ou le poids souhaité.
                </p>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl border border-line bg-surface-subtle space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-ink">
                              {item.productName}
                            </div>
                            <div className="text-xs text-ink-secondary font-mono tabular-nums">
                              {item.quantityOrWeight} {item.unitLabel} ×{' '}
                              {item.unitPriceXof.toLocaleString('fr-FR')} FCFA ={' '}
                              <span className="font-bold text-ink">
                                {item.totalPriceXof.toLocaleString('fr-FR')} FCFA
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveCartItem(item.id)}
                            className="p-1 text-ink-muted hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                            title="Retirer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {item.priceProposalStatus === 'pending_customer_approval' &&
                          item.proposedUnitPriceXof && (
                            <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 rounded-lg p-2.5 text-xs space-y-2">
                              <div className="font-semibold text-amber-950 dark:text-amber-200">
                                Nouveau prix proposé par le commerçant :{' '}
                                <span className="font-mono">
                                  {item.proposedUnitPriceXof.toLocaleString('fr-FR')} FCFA /{' '}
                                  {item.unitLabel}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleRespondPrice(item.id, true)}
                                  className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Approuver</span>
                                </button>
                                <button
                                  onClick={() => handleRespondPrice(item.id, false)}
                                  className="px-3 py-1.5 bg-surface border border-line-strong text-ink-secondary rounded-lg font-semibold cursor-pointer"
                                >
                                  Refuser
                                </button>
                              </div>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>

                  {/* Delivery destination quick form */}
                  <div className="pt-3 border-t border-line space-y-2.5">
                    <div className="text-xs font-semibold text-ink-secondary">
                      {diasporaConfig?.enabled
                        ? `Livraison Diaspora pour ${diasporaConfig.beneficiaryName}`
                        : 'Adresse de livraison en Côte d’Ivoire'}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={deliveryCity}
                        onChange={(e) => setDeliveryCity(e.target.value)}
                        placeholder="Ville (ex: Abidjan)"
                        className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                      />
                      <input
                        type="text"
                        value={deliveryCommune}
                        onChange={(e) => setDeliveryCommune(e.target.value)}
                        placeholder="Commune (ex: Cocody)"
                        className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                      />
                    </div>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Quartier, rue, repère..."
                      className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                    />
                  </div>

                  <button
                    disabled={checkingOut || hasPendingPriceProposal}
                    onClick={handleCreateOrder}
                    className="w-full py-3 bg-brand-green hover:bg-brand-green-hover text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {hasPendingPriceProposal
                      ? 'Approuvez d’abord le prix proposé'
                      : checkingOut
                        ? 'Envoi au commerçant...'
                        : 'Valider mes marchandises'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
