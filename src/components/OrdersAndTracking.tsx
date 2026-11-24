import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Order } from '../types.ts';
import { DeliveryTracking } from './DeliveryTracking.tsx';
import { EASE_OUT_EXPO, StaggerCard } from './MotionPrimitives.tsx';
import { OrdersSkeleton } from './Skeletons.tsx';

interface OrdersAndTrackingProps {
  focusOrderId?: number | null;
}

const PROVIDERS = [
  { id: 'wave', label: 'Wave Côte d’Ivoire (Transfert direct ou API)' },
  { id: 'orange_money', label: 'Orange Money' },
  { id: 'mtn_momo', label: 'MTN Mobile Money' },
  { id: 'moov_money', label: 'Moov Money' },
  { id: 'cash_on_delivery', label: 'Paiement à la livraison (Espèces / Mobile Money)' },
];

interface CollectionChannels {
  wavePhone: string | null;
  waveLink: string | null;
  orangePhone: string | null;
  mtnPhone: string | null;
  moovPhone: string | null;
  hasApiWebhooks: Record<string, boolean>;
}

export const OrdersAndTracking: React.FC<OrdersAndTrackingProps> = ({ focusOrderId }) => {
  const { dbUser, signIn, apiFetch } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(focusOrderId || null);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [channels, setChannels] = useState<CollectionChannels | null>(null);

  const [paymentProvider, setPaymentProvider] = useState('wave');
  const [proofPhone, setProofPhone] = useState('');
  const [proofRef, setProofRef] = useState('');
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [priceRespected, setPriceRespected] = useState(true);
  const [reviewComment, setReviewComment] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDesc, setDisputeDesc] = useState('');

  const loadOrders = useCallback(async () => {
    if (!dbUser) {
      setLoading(false);
      return;
    }
    try {
      const list = await apiFetch<Order[]>('/api/orders');
      setOrders(list);
      if (focusOrderId) {
        setSelectedOrderId(focusOrderId);
      } else if (list[0] && !selectedOrderId) {
        setSelectedOrderId(list[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement commandes');
    } finally {
      setLoading(false);
    }
  }, [dbUser, apiFetch, focusOrderId, selectedOrderId]);

  const loadOrderDetail = useCallback(
    async (id: number) => {
      if (!dbUser) return;
      try {
        const detail = await apiFetch<Order>(`/api/orders/${id}`);
        setSelectedOrderDetail(detail);
      } catch {
        // Ignore
      }
    },
    [dbUser, apiFetch]
  );

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    apiFetch<CollectionChannels>('/api/payments/collection-channels')
      .then(setChannels)
      .catch(() => {});
  }, [apiFetch]);

  useEffect(() => {
    if (selectedOrderId) {
      setProofSubmitted(false);
      loadOrderDetail(selectedOrderId);
    }
  }, [selectedOrderId, loadOrderDetail]);

  const handleDeliveryDecision = async (orderId: number, accept: boolean) => {
    try {
      await apiFetch(`/api/orders/${orderId}/delivery-decision`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      setInfoMsg(
        accept
          ? 'Tarif de livraison accepté. Procédez au paiement sécurisé.'
          : 'Tarif de livraison refusé.'
      );
      await loadOrders();
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur décision livraison');
    }
  };

  const handleInitiatePayment = async (orderId: number) => {
    setError(null);
    setProofSubmitted(false);
    try {
      const payment = await apiFetch<{ status: string }>('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          provider: paymentProvider,
          idempotencyKey: `pay_${orderId}_${paymentProvider}_${Date.now()}`,
        }),
      });
      setInfoMsg(
        payment.status === 'COD_PENDING'
          ? 'Paiement à la livraison confirmé ! Préparez le montant exact pour le livreur.'
          : 'Demande de paiement enregistrée. Effectuez le transfert Mobile Money ci-dessous puis indiquez votre référence SMS.'
      );
      await loadOrders();
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur initiation paiement');
    }
  };

  const handleSubmitPaymentProof = async (e: React.FormEvent, paymentId: number, orderId: number) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/payments/${paymentId}/submit-proof`, {
        method: 'POST',
        body: JSON.stringify({
          senderPhone: proofPhone,
          transactionRef: proofRef,
        }),
      });
      setProofSubmitted(true);
      setProofRef('');
      setInfoMsg('Preuve de transfert envoyée ! L’équipe MARCHÉ LIVE vérifie et lance la livraison.');
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur envoi preuve de transfert');
    }
  };

  const handleSandboxWebhook = async (paymentId: number, orderId: number) => {
    setError(null);
    try {
      await apiFetch(`/api/payments/${paymentId}/sandbox-webhook`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'succeeded' }),
      });
      setInfoMsg('Webhook vérifié (Sandbox) : fonds placés en séquestre (HELD), livraison déclenchée.');
      await loadOrders();
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur webhook sandbox');
    }
  };

  const handleConfirmReceipt = async (orderId: number) => {
    setError(null);
    try {
      await apiFetch(`/api/orders/${orderId}/confirm-receipt`, { method: 'POST' });
      setInfoMsg(
        'Réception confirmée ! Le montant net est libéré au commerçant et la commission de 10 % est réglée.'
      );
      await loadOrders();
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur confirmation réception');
    }
  };

  const handleSubmitReview = async (e: React.FormEvent, orderId: number) => {
    e.preventDefault();
    try {
      await apiFetch(`/api/orders/${orderId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          rating: reviewRating,
          priceRespected,
          comment: reviewComment,
        }),
      });
      setReviewComment('');
      setInfoMsg('Merci ! Votre avis vérifié met à jour le badge Commerçant Star.');
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur envoi avis');
    }
  };

  const handleOpenDispute = async (e: React.FormEvent, orderId: number) => {
    e.preventDefault();
    try {
      await apiFetch(`/api/orders/${orderId}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDesc,
        }),
      });
      setDisputeReason('');
      setDisputeDesc('');
      setInfoMsg('Litige enregistré. Les fonds restent bloqués jusqu’à résolution.');
      await loadOrders();
      await loadOrderDetail(orderId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ouverture litige');
    }
  };

  if (!dbUser) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-8 text-center space-y-4">
        <Truck className="w-10 h-10 text-brand-orange-text mx-auto" />
        <h2 className="text-xl font-bold text-ink">Mes commandes & suivi</h2>
        <p className="text-sm text-ink-secondary">
          Connectez-vous pour suivre vos commandes, payer par Mobile Money et localiser la livraison.
        </p>
        <button
          onClick={signIn}
          className="px-6 py-3 bg-brand-green hover:bg-brand-green-hover text-white text-sm font-semibold rounded-xl cursor-pointer"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="orders-skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <OrdersSkeleton />
        </motion.div>
      ) : (
        <motion.div
          key="orders-content"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="space-y-6"
        >
          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
          {infoMsg && (
            <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 px-4 py-3 rounded-xl text-sm">
              {infoMsg}
            </div>
          )}

          {orders.length === 0 ? (
            <div className="bg-surface border border-line rounded-2xl p-8 text-center">
              <p className="text-sm text-ink-secondary">
                Vous n'avez pas encore passé de commande sur MARCHÉ LIVE.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Orders List */}
              <div className="lg:col-span-4 space-y-3">
                <h2 className="text-lg font-bold text-ink">Mes commandes ({orders.length})</h2>
                {orders.map((ord, idx) => (
                  <StaggerCard key={ord.id} index={idx}>
                    <button
                      onClick={() => setSelectedOrderId(ord.id)}
                      className={`w-full text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
                        selectedOrderId === ord.id
                          ? 'bg-surface border-brand-green ring-1 ring-brand-green'
                          : 'bg-surface border-line hover:border-line-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-ink-muted">
                        <span className="font-mono font-semibold text-ink">{ord.orderNumber}</span>
                        <span>{ord.status}</span>
                      </div>
                <div className="font-semibold text-sm text-ink mt-1">
                  {ord.shop?.shopName}
                </div>
                <div className="flex items-center justify-between text-xs text-ink-secondary mt-1 font-mono tabular-nums">
                  <span>{ord.deliveryCity}</span>
                  <span className="font-bold text-brand-green-text">
                    {ord.totalAmountXof.toLocaleString('fr-FR')} FCFA
                  </span>
                </div>
              </button>
                  </StaggerCard>
            ))}
          </div>

          {/* Order Detail + Payment + Interactive Map */}
          {selectedOrderDetail && (
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-surface border border-line rounded-2xl p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-line">
                  <div>
                    <div className="text-xs text-ink-muted font-mono">
                      {selectedOrderDetail.orderNumber} · {selectedOrderDetail.market?.name}
                    </div>
                    <h3 className="text-xl font-bold text-ink mt-0.5">
                      {selectedOrderDetail.shop?.shopName}
                    </h3>
                    <div className="text-xs text-ink-secondary mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-brand-orange-text" />
                      <span>
                        {selectedOrderDetail.deliveryAddress}, {selectedOrderDetail.deliveryCommune},{' '}
                        {selectedOrderDetail.deliveryCity}
                      </span>
                    </div>
                    {selectedOrderDetail.isDiasporaOrder && (
                      <div className="text-xs text-brand-green-text font-medium mt-1">
                        Commande Diaspora pour : {selectedOrderDetail.beneficiaryName} (
                        {selectedOrderDetail.beneficiaryPhone})
                      </div>
                    )}
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-xs text-ink-muted">
                      Marchandises : {selectedOrderDetail.itemsSubtotalXof.toLocaleString('fr-FR')} FCFA
                    </div>
                    <div className="text-xs text-ink-muted">
                      Livraison : {selectedOrderDetail.deliveryFeeXof.toLocaleString('fr-FR')} FCFA
                    </div>
                    <div className="text-lg font-extrabold text-ink mt-0.5">
                      Total : {selectedOrderDetail.totalAmountXof.toLocaleString('fr-FR')} FCFA
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-1.5">
                  {selectedOrderDetail.items?.map((it) => (
                    <div
                      key={it.id}
                      className="flex justify-between text-sm text-ink-secondary py-1 border-b border-line/60 last:border-b-0"
                    >
                      <span>
                        {it.productName} ({it.quantityOrWeight} {it.unitLabel})
                      </span>
                      <span className="font-mono text-ink tabular-nums">
                        {it.totalPriceXof.toLocaleString('fr-FR')} FCFA
                      </span>
                    </div>
                  ))}
                </div>

                {/* Step 9-10: Delivery Quote Decision */}
                {selectedOrderDetail.deliveryRequest &&
                  selectedOrderDetail.deliveryRequest.status === 'quoted' &&
                  selectedOrderDetail.deliveryRequest.customerDecision === 'pending' && (
                    <div className="bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 rounded-xl p-4 space-y-3">
                      <div className="text-sm font-bold text-orange-950 dark:text-orange-200">
                        Devis de livraison :{' '}
                        <span className="font-mono">
                          {selectedOrderDetail.deliveryRequest.quotedPriceXof?.toLocaleString('fr-FR')}{' '}
                          FCFA
                        </span>{' '}
                        ({selectedOrderDetail.deliveryRequest.provider === 'yango_delivery'
                          ? 'Yango Delivery'
                          : 'Livreur manuel'})
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => handleDeliveryDecision(selectedOrderDetail.id, true)}
                          className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Accepter le tarif et passer au paiement
                        </button>
                        <button
                          onClick={() => handleDeliveryDecision(selectedOrderDetail.id, false)}
                          className="px-4 py-2 bg-surface border border-line-strong text-ink-secondary text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Refuser
                        </button>
                      </div>
                    </div>
                  )}

                {/* Step 11: Secure Mobile Money Payment */}
                {selectedOrderDetail.status === 'awaiting_payment' && (
                  <div className="bg-surface-subtle border border-line rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink">
                      <ShieldCheck className="w-4 h-4 text-brand-green-text" />
                      <span>Paiement sécurisé (Séquestre prestataire habilité)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPaymentProvider(p.id)}
                          className={`p-3 rounded-xl border text-left text-xs font-semibold cursor-pointer ${
                            paymentProvider === p.id
                              ? 'border-brand-green bg-brand-green/10 text-brand-green-text'
                              : 'border-line bg-surface text-ink-secondary'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {selectedOrderDetail.latestPayment?.status === 'PENDING' ? (
                      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 space-y-3">
                        <div className="text-xs text-amber-950 dark:text-amber-200 space-y-1">
                          <div className="font-bold">
                            Transfert Mobile Money en attente ({selectedOrderDetail.totalAmountXof.toLocaleString('fr-FR')} FCFA)
                          </div>
                          <div>
                            Référence commande :{' '}
                            <span className="font-mono font-semibold">{selectedOrderDetail.orderNumber}</span>
                            {' · '}Code paiement :{' '}
                            <span className="font-mono">{selectedOrderDetail.latestPayment.providerReference}</span>
                          </div>
                          {(() => {
                            const prov = selectedOrderDetail.latestPayment?.provider;
                            const num =
                              prov === 'wave'
                                ? channels?.wavePhone
                                : prov === 'orange_money'
                                  ? channels?.orangePhone
                                  : prov === 'mtn_momo'
                                    ? channels?.mtnPhone
                                    : prov === 'moov_money'
                                      ? channels?.moovPhone
                                      : null;
                            return (
                              <div className="pt-1 flex flex-wrap items-center gap-3">
                                {num ? (
                                  <span>
                                    Numéro plateforme à créditer : <strong className="font-mono">{num}</strong>
                                  </span>
                                ) : (
                                  <span>
                                    Envoyez le montant sur le numéro marchand MARCHÉ LIVE communiqué par le support puis saisissez votre ID SMS ci-dessous.
                                  </span>
                                )}
                                {prov === 'wave' && channels?.waveLink && (
                                  <a
                                    href={channels.waveLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1 bg-[#1DC8FF] text-slate-950 font-bold rounded-lg whitespace-nowrap"
                                  >
                                    Payer via lien Wave
                                  </a>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {proofSubmitted ? (
                          <div className="text-xs font-semibold text-brand-green-text">
                            Preuve de transfert envoyée. En attente de confirmation par l’administrateur.
                          </div>
                        ) : (
                          <form
                            onSubmit={(e) =>
                              handleSubmitPaymentProof(
                                e,
                                selectedOrderDetail.latestPayment!.id,
                                selectedOrderDetail.id
                              )
                            }
                            className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1"
                          >
                            <input
                              required
                              type="text"
                              value={proofPhone}
                              onChange={(e) => setProofPhone(e.target.value)}
                              placeholder="Votre n° Mobile Money"
                              className="px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                            />
                            <input
                              required
                              type="text"
                              value={proofRef}
                              onChange={(e) => setProofRef(e.target.value)}
                              placeholder="ID / Référence du SMS"
                              className="px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink font-mono placeholder:text-ink-muted"
                            />
                            <button
                              type="submit"
                              className="px-3.5 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
                            >
                              J'ai payé (Envoyer preuve)
                            </button>
                          </form>
                        )}

                        <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/40 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-amber-900/80 dark:text-amber-300/80">
                            Test développeur uniquement :
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleSandboxWebhook(
                                selectedOrderDetail.latestPayment!.id,
                                selectedOrderDetail.id
                              )
                            }
                            className="px-3 py-1.5 bg-ink text-canvas text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Simuler Webhook (Sandbox)
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInitiatePayment(selectedOrderDetail.id)}
                        className="px-5 py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-sm font-semibold rounded-xl flex items-center gap-2 cursor-pointer"
                      >
                        <CreditCard className="w-4 h-4" />
                        <span>
                          {paymentProvider === 'cash_on_delivery'
                            ? `Commander · Payer ${selectedOrderDetail.totalAmountXof.toLocaleString('fr-FR')} FCFA à la livraison`
                            : `Payer ${selectedOrderDetail.totalAmountXof.toLocaleString('fr-FR')} FCFA`}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {/* Confirm Receipt */}
                {(selectedOrderDetail.status === 'paid_preparing' ||
                  selectedOrderDetail.status === 'in_delivery') && (
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-4">
                    <div className="text-xs text-emerald-950 dark:text-emerald-200">
                      {selectedOrderDetail.latestPayment?.status === 'COD_PENDING'
                        ? `Paiement à la livraison (${selectedOrderDetail.totalAmountXof.toLocaleString('fr-FR')} FCFA). Confirmez dès réception du colis.`
                        : "Fonds protégés en séquestre (HELD). Confirmez la réception dès l'arrivée du livreur."}
                    </div>
                    <button
                      onClick={() => handleConfirmReceipt(selectedOrderDetail.id)}
                      className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirmer la réception</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Real-time Delivery Tracking & Route Simulation */}
              <DeliveryTracking order={selectedOrderDetail} />

              {/* Verified Review & Dispute */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedOrderDetail.review ? (
                  <div className="bg-surface border border-line rounded-2xl p-5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-[#EAB308] fill-[#EAB308]" />
                        <span>Votre avis publié</span>
                      </h4>
                      <span className="font-mono text-xs font-bold text-ink tabular-nums">
                        {selectedOrderDetail.review.rating}/5 ★
                      </span>
                    </div>
                    <div className="text-xs text-brand-green-text font-medium">
                      {selectedOrderDetail.review.priceRespected
                        ? 'Prix annoncés en LIVE respectés'
                        : 'Écart de prix signalé'}
                    </div>
                    {selectedOrderDetail.review.comment && (
                      <p className="text-xs text-ink-secondary bg-surface-subtle border border-line rounded-xl p-3">
                        {selectedOrderDetail.review.comment}
                      </p>
                    )}
                  </div>
                ) : selectedOrderDetail.status === 'delivered' ? (
                  <form
                    onSubmit={(e) => handleSubmitReview(e, selectedOrderDetail.id)}
                    className="bg-surface border border-line rounded-2xl p-5 space-y-3"
                  >
                    <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-[#EAB308]" />
                      <span>Évaluer le commerçant (Avis vérifié)</span>
                    </h4>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          type="button"
                          key={n}
                          onClick={() => setReviewRating(n)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg border cursor-pointer ${
                            reviewRating >= n
                              ? 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                              : 'bg-surface border-line text-ink-muted'
                          }`}
                        >
                          {n} ★
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={priceRespected}
                        onChange={(e) => setPriceRespected(e.target.checked)}
                      />
                      <span>Les prix annoncés en LIVE ont été respectés</span>
                    </label>
                    <input
                      type="text"
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Votre commentaire..."
                      className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Publier l'avis
                    </button>
                  </form>
                ) : null}

                <form
                  onSubmit={(e) => handleOpenDispute(e, selectedOrderDetail.id)}
                  className="bg-surface border border-line rounded-2xl p-5 space-y-3"
                >
                  <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span>Signaler un litige</span>
                  </h4>
                  <input
                    required
                    type="text"
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="Motif (produit manquant, qualité...)"
                    className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                  <textarea
                    required
                    rows={2}
                    value={disputeDesc}
                    onChange={(e) => setDisputeDesc(e.target.value)}
                    placeholder="Décrivez le problème..."
                    className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-ink text-canvas text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Ouvrir un litige
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
