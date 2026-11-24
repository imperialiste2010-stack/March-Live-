import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Check,
  DollarSign,
  Navigation,
  Package,
  Plus,
  Radio,
  ShieldCheck,
  Store,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  CartItem,
  Market,
  MerchantShop,
  Order,
  Product,
  ProductCategory,
} from '../types.ts';
import { motion } from 'motion/react';
import { EASE_OUT_EXPO } from './MotionPrimitives.tsx';
import { ShopQRCodeCard } from './ShopQRCodeCard.tsx';
import { MerchantDashboardSkeleton } from './Skeletons.tsx';

interface MerchantWorkspaceProps {
  markets: Market[];
  categories: ProductCategory[];
  onJoinLiveAsHost: (sessionId: number) => void;
}

export const MerchantWorkspace: React.FC<MerchantWorkspaceProps> = ({
  markets,
  categories,
  onJoinLiveAsHost,
}) => {
  const { dbUser, signIn, apiFetch, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<{
    registered: boolean;
    shops: MerchantShop[];
    balance?: {
      availableBalanceXof: number;
      pendingEscrowXof: number;
      totalPaidOutXof: number;
      totalCommissionsXof: number;
    };
    orders?: Array<Order & { customerName: string }>;
    products?: Array<Product & { category: ProductCategory }>;
    commissions?: Array<{
      id: number;
      orderId: number;
      goodsAmountXof: number;
      commissionAmountXof: number;
      status: string;
      createdAt: string;
    }>;
    payouts?: Array<{
      id: number;
      amountXof: number;
      provider: string;
      destinationPhone: string;
      status: string;
      reference: string;
    }>;
    activeLive?: { id: number; title: string; viewerCount: number } | null;
    activeCarts?: Array<{
      id: number;
      customerName: string;
      items: CartItem[];
    }>;
  } | null>(null);

  // Registration form
  const [phone, setPhone] = useState('');
  const [idDocType, setIdDocType] = useState('CNI');
  const [idDocNumber, setIdDocNumber] = useState('');
  const [mmProvider, setMmProvider] = useState('wave');

  // Create shop form
  const [shopName, setShopName] = useState('');
  const [marketId, setMarketId] = useState<number>(markets[0]?.id || 1);
  const [stallLocation, setStallLocation] = useState('');
  const [openingHours, setOpeningHours] = useState('06:30 - 18:30');
  const [selectedCats, setSelectedCats] = useState<string[]>(['legumes']);

  // New product form
  const [prodName, setProdName] = useState('');
  const [prodCatId, setProdCatId] = useState<number>(categories[0]?.id || 1);
  const [prodUnit, setProdUnit] = useState('kg');
  const [prodPrice, setProdPrice] = useState('');
  const [prodStock, setProdStock] = useState('25');

  // Live title & manual delivery quote inputs
  const [liveTitle, setLiveTitle] = useState('');
  const [proposedPrices, setProposedPrices] = useState<Record<number, string>>({});
  const [manualQuotes, setManualQuotes] = useState<
    Record<number, { price: string; courierName: string; courierPhone: string }>
  >({});
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!dbUser) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/merchant/dashboard');
      setDashboard(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement espace commerçant');
    } finally {
      setLoading(false);
    }
  }, [dbUser, apiFetch]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (markets[0] && !marketId) setMarketId(markets[0].id);
    if (categories[0] && !prodCatId) setProdCatId(categories[0].id);
  }, [markets, categories, marketId, prodCatId]);

  const handleRegisterMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/merchant/register', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          idDocType,
          idDocNumber,
          mobileMoneyProvider: mmProvider,
          mobileMoneyNumber: phone,
        }),
      });
      await refreshProfile();
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inscription');
    }
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/merchant/shops', {
        method: 'POST',
        body: JSON.stringify({
          shopName,
          marketId: Number(marketId),
          stallLocation,
          openingHours,
          categories: selectedCats,
        }),
      });
      await refreshProfile();
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur création boutique');
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dashboard?.shops?.[0]) return;
    setError(null);
    try {
      await apiFetch(`/api/merchant/shops/${dashboard.shops[0].id}/products`, {
        method: 'POST',
        body: JSON.stringify({
          name: prodName,
          categoryId: Number(prodCatId),
          unitLabel: prodUnit,
          unitPriceXof: Number(prodPrice),
          stockQty: Number(prodStock),
        }),
      });
      setProdName('');
      setProdPrice('');
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout produit');
    }
  };

  const handleDeleteProduct = async (id: number) => {
    try {
      await apiFetch(`/api/merchant/products/${id}`, { method: 'DELETE' });
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  };

  const handleStartLive = async () => {
    if (!dashboard?.shops?.[0]) return;
    setError(null);
    try {
      const session = await apiFetch<{ id: number }>('/api/lives', {
        method: 'POST',
        body: JSON.stringify({
          shopId: dashboard.shops[0].id,
          title: liveTitle || `En direct de ${dashboard.shops[0].shopName}`,
          cameraFacing: 'environment',
        }),
      });
      onJoinLiveAsHost(session.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer le LIVE');
    }
  };

  const handleProposePrice = async (itemId: number) => {
    const val = Number(proposedPrices[itemId]);
    if (!val || val < 50) return;
    try {
      await apiFetch(`/api/cart-items/${itemId}/propose-price`, {
        method: 'PATCH',
        body: JSON.stringify({ proposedUnitPriceXof: val }),
      });
      setInfoMsg('Nouvelle proposition de prix envoyée au client pour approbation.');
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur proposition de prix');
    }
  };

  const handleOrderDecision = async (orderId: number, accept: boolean) => {
    try {
      await apiFetch(`/api/orders/${orderId}/merchant-decision`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur décision commande');
    }
  };

  const handleRequestDelivery = async (orderId: number) => {
    try {
      const res = await apiFetch<{ mode: string; message?: string }>(
        `/api/orders/${orderId}/request-delivery-quote`,
        { method: 'POST' }
      );
      if (res.message) setInfoMsg(res.message);
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur demande livreur');
    }
  };

  const handleSubmitManualQuote = async (orderId: number) => {
    const q = manualQuotes[orderId];
    if (!q?.price) return;
    try {
      await apiFetch(`/api/orders/${orderId}/manual-delivery-quote`, {
        method: 'POST',
        body: JSON.stringify({
          quotedPriceXof: Number(q.price),
          courierName: q.courierName,
          courierPhone: q.courierPhone,
        }),
      });
      setInfoMsg('Tarif livraison transmis au client pour acceptation.');
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur devis manuel');
    }
  };

  const handleShareRealGps = (orderId: number) => {
    if (!navigator.geolocation) {
      setError('Géolocalisation non supportée sur ce navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await apiFetch(`/api/orders/${orderId}/delivery-tracking`, {
            method: 'POST',
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speedKmh: pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0,
            }),
          });
          setInfoMsg('Position GPS réelle transmise au suivi client.');
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : 'Erreur envoi GPS');
        }
      },
      () => setError('Autorisation GPS refusée par l’appareil.')
    );
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dashboard?.shops?.[0]) return;
    try {
      await apiFetch('/api/merchant/payouts', {
        method: 'POST',
        body: JSON.stringify({
          shopId: dashboard.shops[0].id,
          amountXof: Number(payoutAmount),
          provider: mmProvider,
          destinationPhone: payoutPhone,
        }),
      });
      setPayoutAmount('');
      setInfoMsg('Demande de reversement Mobile Money enregistrée.');
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur reversement');
    }
  };

  if (!dbUser) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-8 text-center space-y-4">
        <Store className="w-10 h-10 text-brand-green-text mx-auto" />
        <h2 className="text-xl font-bold text-ink">Espace Commerçant(e)</h2>
        <p className="text-sm text-ink-secondary max-w-md mx-auto">
          Connectez-vous pour enregistrer votre étal, gérer votre catalogue et lancer vos vidéos LIVE sur MARCHÉ LIVE.
        </p>
        <button
          onClick={signIn}
          className="px-6 py-3 bg-brand-green hover:bg-brand-green-hover text-white font-semibold text-sm rounded-xl cursor-pointer"
        >
          Se connecter pour continuer
        </button>
      </div>
    );
  }

  if (loading) {
    return <MerchantDashboardSkeleton />;
  }

  // Step 1: Identity verification
  if (!dashboard?.registered) {
    return (
      <form
        onSubmit={handleRegisterMerchant}
        className="bg-surface border border-line rounded-2xl p-6 md:p-8 max-w-2xl mx-auto space-y-5"
      >
        <div className="flex items-center gap-2 text-brand-green-text">
          <ShieldCheck className="w-5 h-5" />
          <h2 className="text-xl font-bold text-ink">
            Étape 1 : Vérification d'identité & Mobile Money
          </h2>
        </div>
        <p className="text-sm text-ink-secondary">
          Pour garantir la confiance des acheteurs et sécuriser les reversements, renseignez votre pièce d'identité et votre compte Mobile Money.
        </p>

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Téléphone Mobile Money (CI)
            </label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+225 07 XX XX XX XX"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Opérateur de reversement
            </label>
            <select
              value={mmProvider}
              onChange={(e) => setMmProvider(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
            >
              <option value="wave">Wave Côte d'Ivoire</option>
              <option value="orange_money">Orange Money</option>
              <option value="mtn_momo">MTN Mobile Money</option>
              <option value="moov_money">Moov Money</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Type de pièce d'identité
            </label>
            <select
              value={idDocType}
              onChange={(e) => setIdDocType(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
            >
              <option value="CNI">Carte Nationale d'Identité (CNI)</option>
              <option value="Passeport">Passeport</option>
              <option value="Carte consulaire">Carte consulaire / Titre de séjour</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Numéro de la pièce
            </label>
            <input
              required
              type="text"
              value={idDocNumber}
              onChange={(e) => setIdDocNumber(e.target.value)}
              placeholder="CI-XXXXXXXXX"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-3 bg-brand-green hover:bg-brand-green-hover text-white font-semibold text-sm rounded-xl cursor-pointer"
        >
          Valider mon identité commerçant
        </button>
      </form>
    );
  }

  // Step 2: Shop creation
  if (!dashboard.shops || dashboard.shops.length === 0) {
    return (
      <form
        onSubmit={handleCreateShop}
        className="bg-surface border border-line rounded-2xl p-6 md:p-8 max-w-2xl mx-auto space-y-5"
      >
        <div className="flex items-center gap-2 text-brand-orange-text">
          <Store className="w-5 h-5" />
          <h2 className="text-xl font-bold text-ink">
            Étape 2 : Créer votre boutique sur le marché
          </h2>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Nom commercial de l'étal
            </label>
            <input
              required
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Ex: Étal Fraîcheur de Tata Mariam"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Marché & Commune
            </label>
            <select
              value={marketId}
              onChange={(e) => setMarketId(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.city})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Emplacement exact dans le marché
            </label>
            <input
              type="text"
              value={stallLocation}
              onChange={(e) => setStallLocation(e.target.value)}
              placeholder="Allée B, Box 14 (Zone poissons/légumes)"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Horaires d'activité
            </label>
            <input
              type="text"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-secondary mb-2">
            Catégories de marchandises vendues
          </label>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const active = selectedCats.includes(cat.slug);
              return (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() =>
                    setSelectedCats((prev) =>
                      active ? prev.filter((s) => s !== cat.slug) : [...prev, cat.slug]
                    )
                  }
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    active
                      ? 'bg-brand-green text-white border-brand-green'
                      : 'bg-surface text-ink-secondary border-line'
                  }`}
                >
                  {cat.nameFr}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-3 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold text-sm rounded-xl cursor-pointer"
        >
          Ouvrir ma boutique
        </button>
      </form>
    );
  }

  const shop = dashboard.shops[0];
  const balance = dashboard.balance!;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="space-y-6"
    >
      {error && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 px-4 py-3 rounded-xl text-sm flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-semibold cursor-pointer">
            OK
          </button>
        </div>
      )}
      {infoMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 px-4 py-3 rounded-xl text-sm flex justify-between">
          <span>{infoMsg}</span>
          <button onClick={() => setInfoMsg(null)} className="font-semibold cursor-pointer">
            OK
          </button>
        </div>
      )}

      {/* Shop Header & LIVE Launch */}
      <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span>{shop.market?.name}</span>
            <span aria-hidden="true">·</span>
            <span>{shop.stallLocation || shop.market?.commune}</span>
            <span aria-hidden="true">·</span>
            <span>{shop.openingHours}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h2 className="text-2xl font-extrabold text-ink">{shop.shopName}</h2>
            {shop.isStarMerchant && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-1 rounded-lg">
                <Award className="w-3.5 h-3.5" />
                Commerçant Star
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-1">
            {shop.starReason ||
              `Note ${shop.ratingAvg}/5 · ${shop.completedOrdersCount} commandes terminées · ${shop.priceRespectRate}% respect des prix`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {dashboard.activeLive ? (
            <button
              onClick={() => onJoinLiveAsHost(dashboard.activeLive!.id)}
              className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <Radio className="w-4 h-4" />
              <span>Reprendre mon LIVE ({dashboard.activeLive.viewerCount})</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={liveTitle}
                onChange={(e) => setLiveTitle(e.target.value)}
                placeholder="Titre du LIVE (ex: Arrivage poissons frais)"
                className="px-3.5 py-2.5 text-sm border border-line rounded-xl w-64 bg-surface-subtle text-ink placeholder:text-ink-muted"
              />
              <button
                onClick={handleStartLive}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl flex items-center gap-2 cursor-pointer"
              >
                <Radio className="w-4 h-4" />
                <span>Démarrer le LIVE</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Shop QR Code for physical market stall */}
      <ShopQRCodeCard
        shopId={shop.id}
        shopName={shop.shopName}
        marketName={shop.market?.name}
      />

      {/* Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-line rounded-2xl p-5">
          <div className="text-xs text-ink-muted">Solde disponible (retirable)</div>
          <div className="text-2xl font-extrabold text-brand-green-text font-mono tabular-nums mt-1">
            {balance.availableBalanceXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-5">
          <div className="text-xs text-ink-muted">Paiements à recevoir (Séquestre)</div>
          <div className="text-2xl font-extrabold text-ink font-mono tabular-nums mt-1">
            {balance.pendingEscrowXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-5">
          <div className="text-xs text-ink-muted">Commissions MARCHÉ LIVE (10 %)</div>
          <div className="text-2xl font-extrabold text-brand-orange-text font-mono tabular-nums mt-1">
            {balance.totalCommissionsXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-5">
          <div className="text-xs text-ink-muted">Total déjà reversé</div>
          <div className="text-2xl font-extrabold text-ink font-mono tabular-nums mt-1">
            {balance.totalPaidOutXof.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Real-time Incoming Carts & Orders */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Carts in Real Time */}
          {dashboard.activeCarts && dashboard.activeCarts.length > 0 && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
              <h3 className="text-base font-bold text-ink">
                Sélections clients en direct (Paniers actifs)
              </h3>
              {dashboard.activeCarts.map((c) => (
                <div key={c.id} className="p-4 rounded-xl bg-surface-subtle border border-line space-y-3">
                  <div className="text-xs font-semibold text-brand-green-text">
                    Client : {c.customerName}
                  </div>
                  {c.items.map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink">
                      <div>
                        <span className="font-semibold">{it.productName}</span> ·{' '}
                        <span className="font-mono tabular-nums text-ink-secondary">
                          {it.quantityOrWeight} {it.unitLabel} ({it.unitPriceXof.toLocaleString('fr-FR')} FCFA/{it.unitLabel})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="Nouveau prix"
                          value={proposedPrices[it.id] || ''}
                          onChange={(e) =>
                            setProposedPrices((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          className="w-28 px-2 py-1 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                        />
                        <button
                          onClick={() => handleProposePrice(it.id)}
                          className="px-2.5 py-1 bg-ink text-canvas text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Proposer prix
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Orders Management */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Package className="w-4 h-4 text-brand-orange-text" />
              <span>Commandes reçues ({dashboard.orders?.length || 0})</span>
            </h3>

            {!dashboard.orders || dashboard.orders.length === 0 ? (
              <p className="text-sm text-ink-muted py-4">
                Aucune commande reçue pour l'instant.
              </p>
            ) : (
              <div className="space-y-4">
                {dashboard.orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-4 rounded-xl border border-line bg-surface-subtle space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-sm text-ink">
                          {ord.orderNumber} · {ord.customerName}
                        </div>
                        <div className="text-xs text-ink-secondary">
                          {ord.deliveryCity} · {ord.deliveryCommune} — {ord.deliveryAddress}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm text-brand-green-text tabular-nums">
                          Net : {ord.merchantNetXof.toLocaleString('fr-FR')} FCFA
                        </div>
                        <div className="text-[11px] text-ink-muted">Statut : {ord.status}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {ord.status === 'pending_merchant' && (
                        <>
                          <button
                            onClick={() => handleOrderDecision(ord.id, true)}
                            className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Confirmer disponibilité</span>
                          </button>
                          <button
                            onClick={() => handleOrderDecision(ord.id, false)}
                            className="px-3 py-1.5 bg-surface border border-line-strong text-red-700 dark:text-red-400 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Refuser</span>
                          </button>
                        </>
                      )}

                      {ord.status === 'merchant_confirmed' && (
                        <button
                          onClick={() => handleRequestDelivery(ord.id)}
                          className="px-3.5 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>Commander un livreur</span>
                        </button>
                      )}

                      {ord.status === 'awaiting_delivery_quote' && (
                        <div className="w-full bg-surface border border-line rounded-xl p-3 space-y-2">
                          <div className="text-xs font-semibold text-ink-secondary">
                            Mode livreur manuel (API Yango non activée) — Saisir le devis réel :
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="number"
                              placeholder="Tarif FCFA (ex: 1500)"
                              value={manualQuotes[ord.id]?.price || ''}
                              onChange={(e) =>
                                setManualQuotes((prev) => ({
                                  ...prev,
                                  [ord.id]: {
                                    ...prev[ord.id],
                                    price: e.target.value,
                                  },
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                            />
                            <input
                              type="text"
                              placeholder="Nom du livreur"
                              value={manualQuotes[ord.id]?.courierName || ''}
                              onChange={(e) =>
                                setManualQuotes((prev) => ({
                                  ...prev,
                                  [ord.id]: {
                                    ...prev[ord.id],
                                    courierName: e.target.value,
                                  },
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                            />
                            <input
                              type="tel"
                              placeholder="Téléphone livreur"
                              value={manualQuotes[ord.id]?.courierPhone || ''}
                              onChange={(e) =>
                                setManualQuotes((prev) => ({
                                  ...prev,
                                  [ord.id]: {
                                    ...prev[ord.id],
                                    courierPhone: e.target.value,
                                  },
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                            />
                          </div>
                          <button
                            onClick={() => handleSubmitManualQuote(ord.id)}
                            className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Envoyer le tarif au client
                          </button>
                        </div>
                      )}

                      {(ord.status === 'paid_preparing' || ord.status === 'in_delivery') && (
                        <button
                          onClick={() => handleShareRealGps(ord.id)}
                          className="px-3 py-1.5 bg-ink text-canvas text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Partager position GPS réelle</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Catalog + Payouts */}
        <div className="lg:col-span-5 space-y-6">
          {/* Catalog CRUD */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-ink">Mon catalogue & prix</h3>
            <form onSubmit={handleAddProduct} className="space-y-3 bg-surface-subtle p-3.5 rounded-xl border border-line">
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  type="text"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="Nom (ex: Carpe fraîche)"
                  className="col-span-2 px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                />
                <select
                  value={prodCatId}
                  onChange={(e) => setProdCatId(Number(e.target.value))}
                  className="px-2.5 py-2 text-xs border border-line rounded-lg bg-surface text-ink"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameFr}
                    </option>
                  ))}
                </select>
                <select
                  value={prodUnit}
                  onChange={(e) => setProdUnit(e.target.value)}
                  className="px-2.5 py-2 text-xs border border-line rounded-lg bg-surface text-ink"
                >
                  <option value="kg">kg</option>
                  <option value="tas">tas</option>
                  <option value="panier">panier</option>
                  <option value="unité">unité</option>
                  <option value="litre">litre</option>
                </select>
                <input
                  required
                  type="number"
                  min={50}
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                  placeholder="Prix FCFA"
                  className="px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                />
                <input
                  type="number"
                  min={1}
                  value={prodStock}
                  onChange={(e) => setProdStock(e.target.value)}
                  placeholder="Stock"
                  className="px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter au catalogue</span>
              </button>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(dashboard.products || [])
                .filter((p) => p.isAvailable)
                .map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 rounded-xl border border-line text-xs"
                  >
                    <div>
                      <div className="font-semibold text-ink">{p.name}</div>
                      <div className="text-ink-muted font-mono tabular-nums">
                        {p.unitPriceXof.toLocaleString('fr-FR')} FCFA / {p.unitLabel} · Stock : {p.stockQty}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteProduct(p.id)}
                      className="p-1.5 text-ink-muted hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                      title="Retirer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          </div>

          {/* Payouts & Commissions */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-brand-green-text" />
              <span>Reversement Mobile Money</span>
            </h3>
            <form onSubmit={handleRequestPayout} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  type="number"
                  min={500}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="Montant FCFA"
                  className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
                <input
                  required
                  type="tel"
                  value={payoutPhone}
                  onChange={(e) => setPayoutPhone(e.target.value)}
                  placeholder="N° Mobile Money"
                  className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Demander un reversement
              </button>
            </form>

            {dashboard.commissions && dashboard.commissions.length > 0 && (
              <div className="pt-2 border-t border-line space-y-1.5">
                <div className="text-xs font-semibold text-ink-secondary">
                  Historique des commissions (10 %)
                </div>
                {dashboard.commissions.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex justify-between text-xs text-ink-secondary font-mono tabular-nums">
                    <span>Cmd #{c.orderId} ({c.status})</span>
                    <span>−{c.commissionAmountXof.toLocaleString('fr-FR')} FCFA</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
