import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Award, CheckCircle2, Heart, MapPin, QrCode, Radio, ShoppingBasket, Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiUrl } from '../lib/api.ts';
import { CartItem, MerchantShop, Product, ShopReview } from '../types.ts';
import { EASE_OUT_EXPO, StaggerCard } from './MotionPrimitives.tsx';
import { ShopQRCodeCard } from './ShopQRCodeCard.tsx';
import { ShopDetailSkeleton } from './Skeletons.tsx';

interface ShopDetailViewProps {
  shopId: number;
  priceFilter?: { minPrice?: number; maxPrice?: number } | null;
  isFavorite?: boolean;
  onToggleFavorite?: (shopId: number) => void;
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
  onBack: () => void;
  onWatchLive: (sessionId: number) => void;
  onOrderCreated: (orderId: number) => void;
}

export const ShopDetailView: React.FC<ShopDetailViewProps> = ({
  shopId,
  priceFilter,
  isFavorite = false,
  onToggleFavorite,
  diasporaConfig,
  onBack,
  onWatchLive,
  onOrderCreated,
}) => {
  const { dbUser, customerProfile, signIn, apiFetch } = useAuth();
  const [shop, setShop] = useState<
    (MerchantShop & {
      reviews: ShopReview[];
    }) | null
  >(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [subtotalXof, setSubtotalXof] = useState(0);
  const [qtyMap, setQtyMap] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [onlyInBudget, setOnlyInBudget] = useState(
    Boolean(priceFilter && (priceFilter.minPrice !== undefined || priceFilter.maxPrice !== undefined))
  );

  // Shop reviews form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewPriceRespected, setReviewPriceRespected] = useState(true);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [city, setCity] = useState(
    diasporaConfig?.enabled ? diasporaConfig.city : customerProfile?.city || 'Abidjan'
  );
  const [commune, setCommune] = useState(
    diasporaConfig?.enabled ? diasporaConfig.commune : customerProfile?.commune || 'Cocody'
  );
  const [address, setAddress] = useState(
    diasporaConfig?.enabled
      ? `${diasporaConfig.quartier ? diasporaConfig.quartier + ', ' : ''}${diasporaConfig.address}`
      : customerProfile?.addressLabel || ''
  );

  const loadShop = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/shops/${shopId}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Boutique introuvable');
      setShop(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement boutique');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  const loadCart = useCallback(async () => {
    if (!dbUser) return;
    try {
      const data = await apiFetch<{ items: CartItem[]; subtotalXof: number }>(
        `/api/carts/${shopId}`
      );
      setCartItems(data.items || []);
      setSubtotalXof(data.subtotalXof || 0);
    } catch {
      // Ignore
    }
  }, [dbUser, apiFetch, shopId]);

  useEffect(() => {
    loadShop();
    loadCart();
  }, [loadShop, loadCart]);

  const handleAdd = async (prod: Product) => {
    if (!dbUser) {
      await signIn();
      return;
    }
    try {
      await apiFetch(`/api/carts/${shopId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: prod.id,
          quantityOrWeight: qtyMap[prod.id] || 1,
          customerConfirmed: true,
        }),
      });
      await loadCart();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur ajout panier');
    }
  };

  const handleCheckout = async () => {
    if (!address.trim()) {
      setError('Renseignez une adresse précise de livraison.');
      return;
    }
    setCheckingOut(true);
    setError(null);
    try {
      const order = await apiFetch<{ id: number }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          shopId,
          deliveryCity: city,
          deliveryCommune: commune,
          deliveryAddress: address,
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
      setError(err instanceof Error ? err.message : 'Erreur commande');
    } finally {
      setCheckingOut(false);
    }
  };

  const handleSubmitShopReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await signIn();
      return;
    }
    setSubmittingReview(true);
    setReviewError(null);
    setReviewFeedback(null);
    try {
      await apiFetch(`/api/shops/${shopId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          rating: reviewRating,
          priceRespected: reviewPriceRespected,
          comment: reviewComment.trim() || null,
        }),
      });
      setReviewComment('');
      setReviewFeedback('Merci ! Votre avis a été publié et la note de la boutique mise à jour.');
      await loadShop();
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : 'Impossible de publier votre avis.');
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="shop-detail-skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <ShopDetailSkeleton />
        </motion.div>
      ) : !shop ? (
        <motion.div
          key="shop-detail-error"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          className="bg-surface border border-line rounded-2xl p-8 text-center"
        >
          <p className="text-sm text-red-600 dark:text-red-400">{error || 'Boutique introuvable'}</p>
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-ink text-canvas text-xs font-semibold rounded-lg cursor-pointer"
          >
            Retour
          </button>
        </motion.div>
      ) : (
        <motion.div
          key={`shop-detail-${shop.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="space-y-6"
        >
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-secondary hover:text-ink cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour aux marchés</span>
          </button>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.04, ease: EASE_OUT_EXPO }}
            className="bg-surface border border-line rounded-2xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <MapPin className="w-3.5 h-3.5 text-brand-green-text" />
            <span>{shop.market.name}</span>
            <span aria-hidden="true">·</span>
            <span>{shop.market.city}</span>
            <span aria-hidden="true">·</span>
            <span>{shop.openingHours}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-2xl font-extrabold text-ink">{shop.shopName}</h2>
            {shop.isStarMerchant && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 rounded-lg">
                <Award className="w-3.5 h-3.5" />
                Commerçant Star
              </span>
            )}
          </div>
          <div className="text-xs text-ink-secondary mt-1 flex items-center gap-3 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-[#EAB308]" />
              {shop.ratingAvg}/5 ({shop.reviewCount} avis vérifiés)
            </span>
            <span>·</span>
            <span>{shop.completedOrdersCount} commandes livrées</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(shop.id)}
              aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-pressed={isFavorite}
              className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isFavorite
                  ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-300'
                  : 'bg-surface-muted border-line text-ink hover:bg-line'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
              <span>{isFavorite ? 'Favori' : 'Ajouter aux favoris'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowQr((prev) => !prev)}
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              showQr
                ? 'bg-brand-green text-white border-brand-green'
                : 'bg-surface-muted border-line text-ink hover:bg-line'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Code QR</span>
          </button>
          {shop.activeLive && (
            <button
              onClick={() => onWatchLive(shop.activeLive!.id)}
              className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <Radio className="w-4 h-4" />
              <span>Rejoindre le LIVE</span>
            </button>
          )}
        </div>
      </motion.div>

      {showQr && (
        <ShopQRCodeCard
          shopId={shop.id}
          shopName={shop.shopName}
          marketName={shop.market?.name}
        />
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-ink">Catalogue des marchandises</h3>
            {priceFilter && (priceFilter.minPrice !== undefined || priceFilter.maxPrice !== undefined) && (
              <button
                type="button"
                onClick={() => setOnlyInBudget((prev) => !prev)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  onlyInBudget
                    ? 'bg-brand-green text-white border-brand-green'
                    : 'bg-surface text-ink-secondary border-line hover:border-line-strong'
                }`}
              >
                {onlyInBudget ? 'Dans votre budget uniquement' : 'Filtrer selon mon budget'}
              </button>
            )}
          </div>
          {(() => {
            const hasActiveBudget = Boolean(
              priceFilter && (priceFilter.minPrice !== undefined || priceFilter.maxPrice !== undefined)
            );
            const displayedProducts =
              hasActiveBudget && onlyInBudget && shop.products
                ? shop.products.filter(
                    (p) =>
                      (priceFilter?.minPrice === undefined || p.unitPriceXof >= priceFilter.minPrice) &&
                      (priceFilter?.maxPrice === undefined || p.unitPriceXof <= priceFilter.maxPrice)
                  )
                : shop.products || [];

            if (displayedProducts.length === 0) {
              return (
                <div className="bg-surface border border-line rounded-2xl p-6 text-sm text-ink-muted">
                  {hasActiveBudget && onlyInBudget
                    ? 'Aucun produit dans cette tranche de prix pour cette boutique.'
                    : 'Aucun produit disponible pour le moment.'}
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {displayedProducts.map((prod, idx) => {
                  const inBudget =
                    hasActiveBudget &&
                    (priceFilter?.minPrice === undefined || prod.unitPriceXof >= priceFilter.minPrice) &&
                    (priceFilter?.maxPrice === undefined || prod.unitPriceXof <= priceFilter.maxPrice);

                  return (
                    <StaggerCard
                      key={prod.id}
                      index={idx}
                      className={`bg-surface border rounded-2xl p-4 flex flex-col justify-between gap-3 ${
                        inBudget ? 'border-brand-green/60' : 'border-line'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-ink-muted">{prod.category?.nameFr}</div>
                          {inBudget && (
                            <span className="text-[11px] font-semibold text-brand-green-text">
                              Dans votre budget
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-ink mt-0.5">{prod.name}</div>
                        <div className="font-mono font-bold text-brand-green-text tabular-nums mt-1">
                          {prod.unitPriceXof.toLocaleString('fr-FR')} FCFA / {prod.unitLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={qtyMap[prod.id] ?? 1}
                          onChange={(e) =>
                            setQtyMap((prev) => ({
                              ...prev,
                              [prod.id]: Math.max(0.5, Number(e.target.value)),
                            }))
                          }
                          className="w-20 px-2.5 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink font-mono text-center"
                        />
                        <button
                          onClick={() => handleAdd(prod)}
                          className="flex-1 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Ajouter
                        </button>
                      </div>
                    </StaggerCard>
                  );
                })}
              </div>
            );
          })()}

          {/* Customer Reviews Summary, Submission & List */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-line">
              <div>
                <h4 className="text-base font-bold text-ink flex items-center gap-2">
                  <Star className="w-4 h-4 text-[#EAB308] fill-[#EAB308]" />
                  <span>Avis clients</span>
                </h4>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary mt-1 font-mono tabular-nums">
                  <span className="text-sm font-extrabold text-ink">{shop.ratingAvg}/5</span>
                  <span aria-hidden="true">·</span>
                  <span>{shop.reviewCount} avis</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-brand-green-text font-sans font-semibold">
                    {shop.priceRespectRate}% prix respectés
                  </span>
                </div>
              </div>

              <div className="w-full sm:w-56 space-y-1">
                {[5, 4, 3, 2, 1].map((starLevel) => {
                  const count = (shop.reviews || []).filter((r) => r.rating === starLevel).length;
                  const total = shop.reviews?.length || 0;
                  return (
                    <div key={starLevel} className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                      <span className="w-6 text-ink-muted">{starLevel}★</span>
                      <progress
                        value={count}
                        max={Math.max(1, total)}
                        aria-label={`${starLevel} étoiles`}
                        className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-muted [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-[#EAB308] [&::-moz-progress-bar]:bg-[#EAB308]"
                      />
                      <span className="w-5 text-right text-ink-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Leave a Review Form */}
            {dbUser ? (
              <form
                onSubmit={handleSubmitShopReview}
                className="bg-surface-subtle border border-line rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink">Donner votre avis sur {shop.shopName}</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setReviewRating(n)}
                        aria-label={`Attribuer ${n} étoile${n > 1 ? 's' : ''}`}
                        className="p-1 rounded-md hover:bg-surface-muted transition-colors cursor-pointer"
                      >
                        <Star
                          className={`w-5 h-5 ${
                            reviewRating >= n
                              ? 'text-[#EAB308] fill-[#EAB308]'
                              : 'text-ink-muted'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-1.5 font-mono text-xs font-bold text-ink tabular-nums">
                      {reviewRating}/5
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reviewPriceRespected}
                    onChange={(e) => setReviewPriceRespected(e.target.checked)}
                  />
                  <span>Les prix annoncés par le commerçant sont respectés</span>
                </label>

                <textarea
                  rows={2}
                  maxLength={600}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Qualité des produits, accueil en LIVE, fraîcheur, rapidité..."
                  className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted"
                />

                {reviewError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{reviewError}</p>
                )}
                {reviewFeedback && (
                  <p className="text-xs text-brand-green-text font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{reviewFeedback}</span>
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingReview}
                    className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {submittingReview ? 'Publication...' : 'Publier mon avis'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-surface-subtle border border-line rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-ink-secondary">
                  Vous avez acheté ou visité cet étal ? Partagez votre expérience avec la communauté.
                </span>
                <button
                  type="button"
                  onClick={signIn}
                  className="px-3.5 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  Se connecter pour noter
                </button>
              </div>
            )}

            {/* Existing Reviews List */}
            {shop.reviews && shop.reviews.length > 0 ? (
              <div className="space-y-3">
                {shop.reviews.map((r) => (
                  <div
                    key={r.id}
                    className="text-xs border-b border-line pb-3 last:border-b-0 last:pb-0 space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{r.customerName}</span>
                        <span aria-hidden="true" className="text-ink-muted">·</span>
                        <span className={r.isVerifiedPurchase ? 'text-brand-green-text font-medium' : 'text-ink-muted'}>
                          {r.isVerifiedPurchase ? 'Achat vérifié' : 'Client'}
                        </span>
                        {r.createdAt && (
                          <>
                            <span aria-hidden="true" className="text-ink-muted">·</span>
                            <span className="text-ink-muted">
                              {new Date(r.createdAt).toLocaleDateString('fr-FR')}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 font-mono font-bold text-ink tabular-nums">
                        <Star className="w-3.5 h-3.5 text-[#EAB308] fill-[#EAB308]" />
                        <span>{r.rating}/5</span>
                      </div>
                    </div>
                    {r.comment && <p className="text-ink-secondary leading-relaxed">{r.comment}</p>}
                    <div className="text-[11px] text-ink-muted">
                      {r.priceRespected ? 'Prix annoncé respecté' : 'Écart de prix signalé'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                Aucun avis publié pour le moment. Soyez le premier client à partager votre expérience.
              </p>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="lg:col-span-5 bg-surface border border-line rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-ink">
              <ShoppingBasket className="w-5 h-5 text-brand-orange-text" />
              <span>Votre panier</span>
            </div>
            <span className="font-mono font-bold text-brand-green-text tabular-nums">
              {subtotalXof.toLocaleString('fr-FR')} FCFA
            </span>
          </div>

          {cartItems.length === 0 ? (
            <p className="text-xs text-ink-muted">Votre panier est vide.</p>
          ) : (
            <>
              <div className="space-y-2">
                {cartItems.map((it) => (
                  <div key={it.id} className="flex justify-between text-xs border-b border-line pb-2">
                    <span className="text-ink-secondary">
                      {it.productName} ({it.quantityOrWeight} {it.unitLabel})
                    </span>
                    <span className="font-mono font-semibold text-ink tabular-nums">
                      {it.totalPriceXof.toLocaleString('fr-FR')} FCFA
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ville"
                    className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                  <input
                    type="text"
                    value={commune}
                    onChange={(e) => setCommune(e.target.value)}
                    placeholder="Commune"
                    className="px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                </div>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Quartier et adresse exacte"
                  className="w-full px-3 py-2 text-xs border border-line rounded-lg bg-surface-subtle text-ink placeholder:text-ink-muted"
                />
              </div>
              <button
                disabled={checkingOut}
                onClick={handleCheckout}
                className="w-full py-3 bg-brand-green hover:bg-brand-green-hover text-white text-sm font-semibold rounded-xl cursor-pointer disabled:opacity-50"
              >
                {checkingOut ? 'Validation...' : 'Commander chez ce commerçant'}
              </button>
            </>
          )}
        </div>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
