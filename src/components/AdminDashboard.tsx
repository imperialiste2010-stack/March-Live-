import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  Plus,
  ShieldAlert,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Market } from '../types.ts';
import { EASE_OUT_EXPO, StaggerCard } from './MotionPrimitives.tsx';
import {
  MARCHE_LIVE_LOGO_SVG,
  MarcheLiveLockup,
  MarcheLiveMark,
} from './MarcheLiveLogo.tsx';

interface AdminOverview {
  kpis: {
    customersCount: number;
    merchantsCount: number;
    connectedMerchantsCount: number;
    activeLivesCount: number;
    dailyOrdersCount: number;
    totalOrdersCount: number;
    totalRevenueXof: number;
    totalCommissionsXof: number;
    inDeliveryCount: number;
    pendingPaymentsCount: number;
    openDisputesCount: number;
  };
  commissionBreakdown?: {
    settledXof: number;
    accruedXof: number;
    refundedXof: number;
    totalCollectedGoodsXof: number;
    merchantEscrowHeldXof: number;
    merchantAvailableXof: number;
    merchantPayoutsProcessingXof: number;
    merchantPayoutsPaidXof: number;
  };
  pendingManualPayments?: Array<{
    id: number;
    orderId: number;
    orderNumber: string;
    shopName: string;
    customerName: string;
    provider: string;
    providerReference: string | null;
    amountXof: number;
    senderPhone: string | null;
    transactionRef: string | null;
    createdAt: string;
  }>;
  commissions?: Array<{
    id: number;
    orderId: number;
    orderNumber: string;
    shopId: number;
    shopName: string;
    goodsAmountXof: number;
    ratePercent: number;
    commissionAmountXof: number;
    status: string;
    createdAt: string;
  }>;
  payouts?: Array<{
    id: number;
    shopId: number;
    shopName: string;
    amountXof: number;
    provider: string;
    destinationPhone: string;
    status: string;
    reference: string | null;
    requestedAt: string;
    processedAt: string | null;
  }>;
  users: Array<{ id: number; email: string; fullName: string | null; role: string }>;
  markets: Market[];
  marketRanking: Array<{
    marketId: number;
    name: string;
    city: string;
    shops: number;
    orders: number;
    revenueXof: number;
  }>;
  merchantRanking: Array<{
    id: number;
    shopName: string;
    marketName: string;
    city: string;
    completedOrdersCount: number;
    ratingAvg: number;
    isStarMerchant: boolean;
    isApproved: boolean;
  }>;
  cityAnalytics: Array<{ city: string; orders: number; revenueXof: number }>;
  disputes: Array<{
    id: number;
    orderId: number;
    reason: string;
    description: string;
    status: string;
  }>;
  auditLogs: Array<{
    id: number;
    actorRole: string | null;
    action: string;
    entityType: string;
    createdAt: string;
  }>;
}

const PROVIDER_LABELS: Record<string, string> = {
  wave: 'Wave',
  orange_money: 'Orange Money',
  mtn_momo: 'MTN MoMo',
  moov_money: 'Moov Money',
  card: 'Carte',
};

export const AdminDashboard: React.FC = () => {
  const { dbUser, signIn, apiFetch, refreshProfile } = useAuth();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingPayoutId, setProcessingPayoutId] = useState<number | null>(null);
  const [processingPaymentId, setProcessingPaymentId] = useState<number | null>(null);
  const [payoutRefs, setPayoutRefs] = useState<Record<number, string>>({});

  const [mName, setMName] = useState('');
  const [mCity, setMCity] = useState('');
  const [mCommune, setMCommune] = useState('');
  const [mLat, setMLat] = useState('5.3484');
  const [mLng, setMLng] = useState('-4.0083');

  const isAdmin =
    dbUser &&
    ['super_admin', 'admin', 'support', 'finance_controller'].includes(dbUser.role);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const overview = await apiFetch<AdminOverview>('/api/admin/overview');
      setData(overview);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement administration');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, apiFetch]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleBootstrapSuperAdmin = async () => {
    setError(null);
    try {
      await apiFetch('/api/admin/bootstrap', { method: 'POST' });
      await refreshProfile();
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Activation refusée');
    }
  };

  const handleAddMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/markets', {
        method: 'POST',
        body: JSON.stringify({
          name: mName,
          city: mCity,
          commune: mCommune,
          lat: Number(mLat),
          lng: Number(mLng),
        }),
      });
      setMName('');
      setMCity('');
      setMCommune('');
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout marché');
    }
  };

  const handleChangeRole = async (userId: number, role: string) => {
    try {
      await apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur changement de rôle');
    }
  };

  const handleResolveDispute = async (
    disputeId: number,
    resolution: 'resolved_refund' | 'resolved_release'
  ) => {
    try {
      await apiFetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur résolution litige');
    }
  };

  const handleProcessPayout = async (payoutId: number, status: 'paid' | 'failed') => {
    setError(null);
    setNotice(null);
    setProcessingPayoutId(payoutId);
    try {
      await apiFetch(`/api/admin/payouts/${payoutId}/process`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          reference: payoutRefs[payoutId]?.trim() || undefined,
        }),
      });
      setNotice(
        status === 'paid'
          ? 'Reversement commerçant (90 %) marqué comme payé. Vos 10 % restent acquis sur votre compte.'
          : 'Reversement marqué en échec — montant recrédité sur le solde du commerçant.'
      );
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de traiter le reversement');
    } finally {
      setProcessingPayoutId(null);
    }
  };

  const handleManualPaymentDecision = async (paymentId: number, approve: boolean) => {
    setError(null);
    setNotice(null);
    setProcessingPaymentId(paymentId);
    try {
      await apiFetch(
        `/api/admin/payments/${paymentId}/${approve ? 'confirm-manual' : 'reject-manual'}`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setNotice(
        approve
          ? 'Encaissement Mobile Money confirmé ! Fonds placés en séquestre (90 % commerçant / 10 % commission) et livraison déclenchée.'
          : 'Paiement refusé — le client a été notifié.'
      );
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de traiter ce paiement');
    } finally {
      setProcessingPaymentId(null);
    }
  };

  const handleDownloadLogoSvg = () => {
    const blob = new Blob([MARCHE_LIVE_LOGO_SVG], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'marche-live-logo.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!dbUser) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-8 text-center space-y-4">
        <Lock className="w-9 h-9 text-ink-secondary mx-auto" />
        <h2 className="text-xl font-bold text-ink">Espace Administrateur sécurisé</h2>
        <button
          onClick={signIn}
          className="px-5 py-2.5 bg-ink text-canvas text-sm font-semibold rounded-xl cursor-pointer"
        >
          Se connecter
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-8 text-center space-y-4 max-w-lg mx-auto">
        <ShieldAlert className="w-10 h-10 text-brand-orange-text mx-auto" />
        <h2 className="text-xl font-bold text-ink">Accès Back-Office Restreint</h2>
        <p className="text-sm text-ink-secondary">
          Votre rôle actuel est <strong className="font-mono text-ink">{dbUser.role}</strong>. L'accès est réservé aux rôles Super Administrateur, Administrateur, Support et Contrôleur financier.
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          onClick={handleBootstrapSuperAdmin}
          className="px-5 py-2.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
        >
          Initialiser mon compte Super Administrateur (premier déploiement)
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return <div className="p-8 text-center text-sm text-ink-muted">Chargement des statistiques...</div>;
  }

  const breakdown = data.commissionBreakdown || {
    settledXof: 0,
    accruedXof: 0,
    refundedXof: 0,
    totalCollectedGoodsXof: 0,
    merchantEscrowHeldXof: 0,
    merchantAvailableXof: 0,
    merchantPayoutsProcessingXof: 0,
    merchantPayoutsPaidXof: 0,
  };
  const commissionList = data.commissions || [];
  const payoutList = data.payouts || [];
  const canProcessPayouts = ['super_admin', 'admin', 'finance_controller'].includes(dbUser.role);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-ink">
            Back-Office MARCHÉ LIVE
          </h2>
          <p className="text-xs text-ink-muted">
            Rôle actif : <span className="font-mono font-semibold text-ink-secondary">{dbUser.role}</span> · Données temps réel PostgreSQL
          </p>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      {notice && <div className="text-sm text-brand-green-text font-medium">{notice}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Clients', val: data.kpis.customersCount },
          { label: 'Commerçants', val: data.kpis.merchantsCount },
          { label: 'Connectés', val: data.kpis.connectedMerchantsCount },
          { label: 'LIVE actifs', val: data.kpis.activeLivesCount },
          { label: 'Commandes / jour', val: data.kpis.dailyOrdersCount },
          { label: 'Litiges ouverts', val: data.kpis.openDisputesCount },
        ].map((k, idx) => (
          <StaggerCard
            key={k.label}
            index={idx}
            hoverLift={false}
            className="bg-surface border border-line rounded-xl p-4"
          >
            <div className="text-xs text-ink-muted">{k.label}</div>
            <div className="text-2xl font-extrabold text-ink font-mono tabular-nums mt-1">
              {k.val}
            </div>
          </StaggerCard>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-line rounded-xl p-4">
          <div className="text-xs text-ink-muted">Chiffre d'affaires total</div>
          <div className="text-xl font-bold text-ink font-mono tabular-nums mt-1">
            {data.kpis.totalRevenueXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
        <div className="bg-surface border border-line rounded-xl p-4">
          <div className="text-xs text-ink-muted">Commissions totales (10 %)</div>
          <div className="text-xl font-bold text-brand-green-text font-mono tabular-nums mt-1">
            {data.kpis.totalCommissionsXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
        <div className="bg-surface border border-line rounded-xl p-4">
          <div className="text-xs text-ink-muted">Livraisons en cours</div>
          <div className="text-xl font-bold text-brand-orange-text font-mono tabular-nums mt-1">
            {data.kpis.inDeliveryCount}
          </div>
        </div>
        <div className="bg-surface border border-line rounded-xl p-4">
          <div className="text-xs text-ink-muted">Paiements en attente / séquestre</div>
          <div className="text-xl font-bold text-ink font-mono tabular-nums mt-1">
            {data.kpis.pendingPaymentsCount}
          </div>
        </div>
      </div>

      {/* Trésorerie Mobile Money & Commissions 10% */}
      <div className="bg-surface border border-line rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Wallet className="w-4 h-4 text-brand-green-text" />
              <span>Trésorerie Mobile Money &amp; Rétention des 10 %</span>
            </h3>
            <p className="text-xs text-ink-secondary mt-1 max-w-3xl">
              Le client paie 100 % sur votre compte marchand plateforme (Wave / Orange / MTN / Moov). Vos 10 % de commission restent automatiquement sur votre compte lorsque vous ne reversez que les 90 % nets aux commerçants.
            </p>
          </div>
          <div className="text-xs text-ink-muted font-mono tabular-nums">
            Total encaissé vérifié : {breakdown.totalCollectedGoodsXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-surface-subtle border border-line rounded-xl p-4">
            <div className="text-xs text-ink-muted">Commissions 10 % acquises</div>
            <div className="text-xl font-extrabold text-brand-green-text font-mono tabular-nums mt-1">
              {breakdown.settledXof.toLocaleString('fr-FR')} FCFA
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              Commandes livrées · Conservé sur votre compte
            </div>
          </div>

          <div className="bg-surface-subtle border border-line rounded-xl p-4">
            <div className="text-xs text-ink-muted">Commissions 10 % en séquestre</div>
            <div className="text-xl font-extrabold text-brand-orange-text font-mono tabular-nums mt-1">
              {breakdown.accruedXof.toLocaleString('fr-FR')} FCFA
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              En attente de confirmation de livraison
            </div>
          </div>

          <div className="bg-surface-subtle border border-line rounded-xl p-4">
            <div className="text-xs text-ink-muted">Net commerçants à reverser (90 %)</div>
            <div className="text-xl font-extrabold text-ink font-mono tabular-nums mt-1">
              {(breakdown.merchantAvailableXof + breakdown.merchantPayoutsProcessingXof).toLocaleString('fr-FR')} FCFA
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              Disponible : {breakdown.merchantAvailableXof.toLocaleString('fr-FR')} · En cours : {breakdown.merchantPayoutsProcessingXof.toLocaleString('fr-FR')}
            </div>
          </div>

          <div className="bg-surface-subtle border border-line rounded-xl p-4">
            <div className="text-xs text-ink-muted">Net commerçants déjà reversé (90 %)</div>
            <div className="text-xl font-extrabold text-ink font-mono tabular-nums mt-1">
              {breakdown.merchantPayoutsPaidXof.toLocaleString('fr-FR')} FCFA
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              Séquestre 90 % en cours : {breakdown.merchantEscrowHeldXof.toLocaleString('fr-FR')} FCFA
            </div>
          </div>
        </div>

        {/* Manual Mobile Money Verification Queue (Zero-API Mode) */}
        {(data.pendingManualPayments || []).length > 0 && (
          <div className="pt-3 border-t border-line space-y-3">
            <h4 className="text-sm font-bold text-ink">
              Encaissements Mobile Money à vérifier ({data.pendingManualPayments?.length || 0})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data.pendingManualPayments || []).map((pm) => (
                <div
                  key={pm.id}
                  className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-ink">
                        {pm.orderNumber} · {pm.shopName}
                      </div>
                      <div className="text-ink-secondary">
                        {pm.customerName} · {PROVIDER_LABELS[pm.provider] || pm.provider}
                      </div>
                    </div>
                    <div className="font-mono font-extrabold text-ink tabular-nums">
                      {pm.amountXof.toLocaleString('fr-FR')} FCFA
                    </div>
                  </div>
                  <div className="text-[11px] text-ink-muted font-mono">
                    {pm.transactionRef ? (
                      <>
                        Réf. SMS : <strong className="text-ink">{pm.transactionRef}</strong> · Tél :{' '}
                        {pm.senderPhone}
                      </>
                    ) : (
                      <>Code : {pm.providerReference} · En attente de preuve ou vérification SMS</>
                    )}
                  </div>
                  {canProcessPayouts && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={processingPaymentId === pm.id}
                        onClick={() => handleManualPaymentDecision(pm.id, true)}
                        className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        Confirmer encaissement reçu
                      </button>
                      <button
                        type="button"
                        disabled={processingPaymentId === pm.id}
                        onClick={() => handleManualPaymentDecision(pm.id, false)}
                        className="px-2.5 py-1.5 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        Non reçu
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t border-line">
          {/* Payout Requests (90% net) */}
          <div className="lg:col-span-6 space-y-3">
            <h4 className="text-sm font-bold text-ink">
              Reversements commerçants demandés ({payoutList.length})
            </h4>
            {payoutList.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Aucune demande de reversement Mobile Money pour le moment.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {payoutList.map((p) => {
                  const isPending = p.status === 'processing' || p.status === 'requested';
                  return (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl bg-surface-subtle border border-line text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-ink">{p.shopName}</div>
                          <div className="text-ink-muted">
                            {PROVIDER_LABELS[p.provider] || p.provider} · {p.destinationPhone}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="font-bold text-ink">
                            {p.amountXof.toLocaleString('fr-FR')} FCFA
                          </div>
                          <div
                            className={`inline-flex items-center gap-1 text-[11px] font-sans font-semibold ${
                              p.status === 'paid'
                                ? 'text-brand-green-text'
                                : p.status === 'failed'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-brand-orange-text'
                            }`}
                          >
                            {p.status === 'paid' ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Payé (90 %)</span>
                              </>
                            ) : p.status === 'failed' ? (
                              <>
                                <XCircle className="w-3 h-3" />
                                <span>Échec</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" />
                                <span>À transférer</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {isPending && canProcessPayouts ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={payoutRefs[p.id] ?? p.reference ?? ''}
                            onChange={(e) =>
                              setPayoutRefs((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            placeholder="Réf. transfert Wave / Orange..."
                            className="flex-1 min-w-[160px] px-2.5 py-1 text-xs border border-line rounded-lg bg-surface text-ink font-mono placeholder:text-ink-muted"
                          />
                          <button
                            type="button"
                            disabled={processingPayoutId === p.id}
                            onClick={() => handleProcessPayout(p.id, 'paid')}
                            className="px-3 py-1 bg-brand-green hover:bg-brand-green-hover text-white font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            Valider payé
                          </button>
                          <button
                            type="button"
                            disabled={processingPayoutId === p.id}
                            onClick={() => handleProcessPayout(p.id, 'failed')}
                            className="px-2.5 py-1 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            Échec
                          </button>
                        </div>
                      ) : (
                        p.reference && (
                          <div className="text-[11px] font-mono text-ink-muted">
                            Réf. : {p.reference}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 10% Commission Ledger */}
          <div className="lg:col-span-6 space-y-3">
            <h4 className="text-sm font-bold text-ink">
              Journal des commissions 10 % ({commissionList.length})
            </h4>
            {commissionList.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Les commissions de 10 % apparaissent dès la confirmation webhook d'un paiement Mobile Money.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-line rounded-xl divide-y divide-line">
                {commissionList.map((c) => (
                  <div
                    key={c.id}
                    className="px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink truncate">
                        {c.orderNumber} · {c.shopName}
                      </div>
                      <div className="text-ink-muted font-mono tabular-nums">
                        Panier : {c.goodsAmountXof.toLocaleString('fr-FR')} FCFA · {c.ratePercent}%
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-brand-green-text font-mono tabular-nums">
                        +{c.commissionAmountXof.toLocaleString('fr-FR')} FCFA
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          c.status === 'settled'
                            ? 'text-brand-green-text'
                            : c.status === 'refunded'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-brand-orange-text'
                        }`}
                      >
                        {c.status === 'settled'
                          ? 'Acquise'
                          : c.status === 'refunded'
                            ? 'Remboursée'
                            : 'Séquestre'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Markets & City Analytics */}
        <div className="lg:col-span-6 bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-green-text" />
            <span>Classement des marchés ({data.markets.length} actifs)</span>
          </h3>
          <div className="max-h-64 overflow-y-auto divide-y divide-line">
            {data.marketRanking.map((m) => (
              <div key={m.marketId} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-ink">{m.name}</div>
                  <div className="text-ink-muted">{m.city} · {m.shops} boutique(s)</div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="font-bold text-ink">{m.revenueXof.toLocaleString('fr-FR')} FCFA</div>
                  <div className="text-ink-muted">{m.orders} cmd(s)</div>
                </div>
              </div>
            ))}
          </div>

          {(dbUser.role === 'super_admin' || dbUser.role === 'admin') && (
            <form onSubmit={handleAddMarket} className="pt-3 border-t border-line space-y-2">
              <div className="text-xs font-semibold text-ink-secondary">Ajouter un nouveau marché</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  required
                  type="text"
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="Nom du marché"
                  className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
                <input
                  required
                  type="text"
                  value={mCity}
                  onChange={(e) => setMCity(e.target.value)}
                  placeholder="Ville"
                  className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
                <input
                  required
                  type="text"
                  value={mCommune}
                  onChange={(e) => setMCommune(e.target.value)}
                  placeholder="Commune"
                  className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  required
                  type="text"
                  value={mLat}
                  onChange={(e) => setMLat(e.target.value)}
                  placeholder="Latitude"
                  className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink font-mono placeholder:text-ink-muted"
                />
                <input
                  required
                  type="text"
                  value={mLng}
                  onChange={(e) => setMLng(e.target.value)}
                  placeholder="Longitude"
                  className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink font-mono placeholder:text-ink-muted"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ajouter</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Users & RBAC + Disputes */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-orange-text" />
              <span>Utilisateurs & Permissions RBAC</span>
            </h3>
            <div className="max-h-52 overflow-y-auto divide-y divide-line">
              {data.users.map((u) => (
                <div key={u.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">
                      {u.fullName || u.email}
                    </div>
                    <div className="text-ink-muted truncate">{u.email}</div>
                  </div>
                  {dbUser.role === 'super_admin' ? (
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeRole(u.id, e.target.value)}
                      className="px-2 py-1 border border-line rounded-lg text-xs font-mono bg-surface-subtle text-ink"
                    >
                      <option value="customer">customer</option>
                      <option value="merchant">merchant</option>
                      <option value="support">support</option>
                      <option value="finance_controller">finance_controller</option>
                      <option value="admin">admin</option>
                      <option value="super_admin">super_admin</option>
                    </select>
                  ) : (
                    <span className="font-mono text-ink-secondary">{u.role}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-base font-bold text-ink">
              Litiges & remboursements ({data.disputes.length})
            </h3>
            {data.disputes.length === 0 ? (
              <p className="text-xs text-ink-muted">Aucun litige signalé.</p>
            ) : (
              <div className="space-y-2.5 max-h-48 overflow-y-auto">
                {data.disputes.map((d) => (
                  <div key={d.id} className="p-3 rounded-xl bg-surface-subtle border border-line text-xs space-y-2">
                    <div className="flex justify-between font-semibold text-ink">
                      <span>Cmd #{d.orderId} · {d.reason}</span>
                      <span>{d.status}</span>
                    </div>
                    <p className="text-ink-secondary">{d.description}</p>
                    {d.status === 'open' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResolveDispute(d.id, 'resolved_refund')}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer"
                        >
                          Rembourser client
                        </button>
                        <button
                          onClick={() => handleResolveDispute(d.id, 'resolved_release')}
                          className="px-2.5 py-1 bg-brand-green hover:bg-brand-green-hover text-white rounded-lg cursor-pointer"
                        >
                          Libérer au commerçant
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Brand Logo Kit Preview & Download */}
      <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <MarcheLiveMark className="w-14 h-14 shrink-0" />
          <div>
            <MarcheLiveLockup size="sm" />
            <p className="text-xs text-ink-muted mt-1">
              Logo officiel MARCHÉ LIVE · Format vectoriel haute définition pour dossiers Wave / Orange Money, affiches marché et WhatsApp Business.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadLogoSvg}
          className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Télécharger le logo (.SVG)</span>
        </button>
      </div>
    </motion.div>
  );
};
