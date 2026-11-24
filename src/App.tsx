import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowUpDown,
  Award,
  Banknote,
  Bell,
  BellRing,
  ClipboardList,
  Compass,
  Heart,
  History,
  MapPin,
  Moon,
  Package,
  Plus,
  QrCode,
  Radio,
  Search,
  Send,
  Shield,
  Store,
  Sun,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { usePushNotifications } from './hooks/usePushNotifications.ts';
import { apiUrl, wsUrl } from './lib/api.ts';
import { auth } from './lib/firebase.ts';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { DiasporaHub } from './components/DiasporaHub.tsx';
import { EarningsSimulator } from './components/EarningsSimulator.tsx';
import { LiveRoom } from './components/LiveRoom.tsx';
import { MarcheLiveMark } from './components/MarcheLiveLogo.tsx';
import { MarketDeliveryMap } from './components/MarketDeliveryMap.tsx';
import { MerchantWorkspace } from './components/MerchantWorkspace.tsx';
import { EASE_OUT_EXPO, FadeSection, StaggerCard } from './components/MotionPrimitives.tsx';
import { OrdersAndTracking } from './components/OrdersAndTracking.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls.tsx';
import { QRScannerModal } from './components/QRScannerModal.tsx';
import { ShopDetailView } from './components/ShopDetailView.tsx';
import { MerchantGridSkeleton } from './components/Skeletons.tsx';
import { LiveSession, Market, MerchantShop, ProductCategory } from './types.ts';

type ActiveView =
  | 'markets'
  | 'become_merchant'
  | 'merchant_space'
  | 'diaspora'
  | 'orders'
  | 'admin'
  | 'profile'
  | 'live_room'
  | 'shop_detail';

const CITIES = [
  'Toutes les villes',
  'Abidjan',
  'Bouaké',
  'Yamoussoukro',
  'Daloa',
  'San Pedro',
  'Korhogo',
  'Man',
  'Gagnoa',
  'Abengourou',
];

type PricePresetId = 'all' | '0-2000' | '2000-5000' | '5000-15000' | '15000+' | 'custom';

const PRICE_RANGES: Array<{
  id: PricePresetId;
  label: string;
  minPrice?: number;
  maxPrice?: number;
}> = [
  { id: 'all', label: 'Tous les budgets (FCFA)' },
  { id: '0-2000', label: 'Moins de 2 000 FCFA', maxPrice: 2000 },
  { id: '2000-5000', label: '2 000 – 5 000 FCFA', minPrice: 2000, maxPrice: 5000 },
  { id: '5000-15000', label: '5 000 – 15 000 FCFA', minPrice: 5000, maxPrice: 15000 },
  { id: '15000+', label: 'Plus de 15 000 FCFA', minPrice: 15000 },
  { id: 'custom', label: 'Budget personnalisé…' },
];

type ShopSortOption = 'relevance' | 'price_asc' | 'price_desc' | 'rating_desc';

const SORT_OPTIONS: Array<{ id: ShopSortOption; label: string }> = [
  { id: 'relevance', label: 'Trier : Pertinence' },
  { id: 'price_asc', label: 'Prix croissant' },
  { id: 'price_desc', label: 'Prix décroissant' },
  { id: 'rating_desc', label: 'Note (meilleure d’abord)' },
];

interface SearchHistoryEntry {
  id: string;
  query: string;
  city: string;
  pricePreset: PricePresetId;
  customMinPrice: string;
  customMaxPrice: string;
  label: string;
  updatedAt: number;
}

const SEARCH_HISTORY_KEY = 'marche_live_search_history';

function MarcheLiveApp() {
  const {
    dbUser,
    customerProfile,
    unreadNotificationsCount,
    lang,
    setLang,
    signIn,
    logout,
    apiFetch,
    refreshProfile,
  } = useAuth();

  const [view, setView] = useState<ActiveView>('markets');
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('marche_live_theme', next);
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }, []);

  // Reference & catalog data
  const [markets, setMarkets] = useState<Market[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [shops, setShops] = useState<MerchantShop[]>([]);
  const [activeLives, setActiveLives] = useState<
    Array<LiveSession & { shop: MerchantShop; market: Market }>
  >([]);
  const [loadingFeed, setLoadingFeed] = useState(true);

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('Toutes les villes');
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<ShopSortOption>('relevance');
  const [pricePreset, setPricePreset] = useState<PricePresetId>('all');
  const [customMinPrice, setCustomMinPrice] = useState('');
  const [customMaxPrice, setCustomMaxPrice] = useState('');
  const [debouncedCustomMin, setDebouncedCustomMin] = useState('');
  const [debouncedCustomMax, setDebouncedCustomMax] = useState('');

  // Search history (persisted in localStorage)
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch {
      return [];
    }
  });

  // Favorite merchants (persisted in user profile)
  const [favoriteShopIds, setFavoriteShopIds] = useState<number[]>([]);
  const [favoriteShopsList, setFavoriteShopsList] = useState<MerchantShop[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCustomMin(customMinPrice);
      setDebouncedCustomMax(customMaxPrice);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customMinPrice, customMaxPrice]);

  const activePriceBounds = useMemo(() => {
    if (pricePreset === 'custom') {
      const parsedMin = debouncedCustomMin.trim() !== '' ? Number(debouncedCustomMin) : undefined;
      const parsedMax = debouncedCustomMax.trim() !== '' ? Number(debouncedCustomMax) : undefined;
      let minPrice =
        parsedMin !== undefined && Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : undefined;
      let maxPrice =
        parsedMax !== undefined && Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : undefined;
      if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
        [minPrice, maxPrice] = [maxPrice, minPrice];
      }
      return { minPrice, maxPrice };
    }
    const preset = PRICE_RANGES.find((r) => r.id === pricePreset);
    return {
      minPrice: preset?.minPrice,
      maxPrice: preset?.maxPrice,
    };
  }, [pricePreset, debouncedCustomMin, debouncedCustomMax]);

  const hasPriceFilter =
    activePriceBounds.minPrice !== undefined || activePriceBounds.maxPrice !== undefined;

  const activePriceLabel = useMemo(() => {
    if (!hasPriceFilter) return null;
    if (pricePreset !== 'custom') {
      return PRICE_RANGES.find((r) => r.id === pricePreset)?.label || null;
    }
    const { minPrice, maxPrice } = activePriceBounds;
    if (minPrice !== undefined && maxPrice !== undefined) {
      return `${minPrice.toLocaleString('fr-FR')} – ${maxPrice.toLocaleString('fr-FR')} FCFA`;
    }
    if (minPrice !== undefined) {
      return `À partir de ${minPrice.toLocaleString('fr-FR')} FCFA`;
    }
    if (maxPrice !== undefined) {
      return `Jusqu'à ${maxPrice.toLocaleString('fr-FR')} FCFA`;
    }
    return null;
  }, [hasPriceFilter, pricePreset, activePriceBounds]);

  const clearPriceFilter = useCallback(() => {
    setPricePreset('all');
    setCustomMinPrice('');
    setCustomMaxPrice('');
    setDebouncedCustomMin('');
    setDebouncedCustomMax('');
  }, []);

  const displayedShops = useMemo(() => {
    const lq = searchQuery.trim().toLowerCase();
    const favSet = new Set(favoriteShopIds);

    const filteredShops = favoritesOnly
      ? shops.filter((s) => favSet.has(s.id))
      : shops;

    const mapped = filteredShops.map((shop) => {
      const allShopProducts = shop.products || [];
      const budgetMatched = allShopProducts.filter(
        (p) =>
          (!hasPriceFilter ||
            ((activePriceBounds.minPrice === undefined ||
              p.unitPriceXof >= activePriceBounds.minPrice) &&
              (activePriceBounds.maxPrice === undefined ||
                p.unitPriceXof <= activePriceBounds.maxPrice))) &&
          (!selectedCategory || p.categorySlug === selectedCategory)
      );
      const queryAndBudgetMatched = lq
        ? budgetMatched.filter((p) => p.name.toLowerCase().includes(lq))
        : budgetMatched;
      const previewProducts =
        queryAndBudgetMatched.length > 0 ? queryAndBudgetMatched : budgetMatched;
      const referenceProducts =
        previewProducts.length > 0 ? previewProducts : allShopProducts;
      const minPriceXof =
        referenceProducts.length > 0
          ? Math.min(...referenceProducts.map((p) => p.unitPriceXof))
          : null;
      const maxPriceXof =
        referenceProducts.length > 0
          ? Math.max(...referenceProducts.map((p) => p.unitPriceXof))
          : null;

      return {
        shop,
        allShopProducts,
        previewProducts,
        minPriceXof,
        maxPriceXof,
      };
    });

    if (sortBy === 'price_asc') {
      mapped.sort((a, b) => {
        const minA = a.minPriceXof ?? Number.POSITIVE_INFINITY;
        const minB = b.minPriceXof ?? Number.POSITIVE_INFINITY;
        if (minA !== minB) return minA - minB;
        return b.shop.ratingAvg - a.shop.ratingAvg;
      });
    } else if (sortBy === 'price_desc') {
      mapped.sort((a, b) => {
        const maxA = a.maxPriceXof ?? -1;
        const maxB = b.maxPriceXof ?? -1;
        if (maxA !== maxB) return maxB - maxA;
        return b.shop.ratingAvg - a.shop.ratingAvg;
      });
    } else if (sortBy === 'rating_desc') {
      mapped.sort((a, b) => {
        if (b.shop.ratingAvg !== a.shop.ratingAvg) {
          return b.shop.ratingAvg - a.shop.ratingAvg;
        }
        if (b.shop.reviewCount !== a.shop.reviewCount) {
          return b.shop.reviewCount - a.shop.reviewCount;
        }
        return b.shop.completedOrdersCount - a.shop.completedOrdersCount;
      });
    }

    return mapped;
  }, [
    shops,
    favoriteShopIds,
    favoritesOnly,
    sortBy,
    hasPriceFilter,
    activePriceBounds.minPrice,
    activePriceBounds.maxPrice,
    selectedCategory,
    searchQuery,
  ]);

  // Active detail targets
  const [activeLiveId, setActiveLiveId] = useState<number | null>(null);
  const [activeLiveHostMode, setActiveLiveHostMode] = useState(false);
  const [activeLiveViaQr, setActiveLiveViaQr] = useState(false);
  const [activeShopId, setActiveShopId] = useState<number | null>(null);
  const [focusOrderId, setFocusOrderId] = useState<number | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);

  // Diaspora session config
  const [diasporaConfig, setDiasporaConfig] = useState<{
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
  } | null>(null);

  // Profile form state
  const [profName, setProfName] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profCity, setProfCity] = useState('Abidjan');
  const [profCommune, setProfCommune] = useState('Cocody');
  const [profQuartier, setProfQuartier] = useState('');
  const [profAddress, setProfAddress] = useState('');
  const [profLat, setProfLat] = useState<number | null>(null);
  const [profLng, setProfLng] = useState<number | null>(null);
  const [profFeedback, setProfFeedback] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<
    Array<{ id: number; title: string; body: string; isRead: boolean; createdAt: string }>
  >([]);
  const [liveToast, setLiveToast] = useState<{
    id: number;
    title: string;
    body: string;
    liveSessionId?: number | null;
  } | null>(null);

  // Shopping list ("Liste de courses") form state
  const [newListProduct, setNewListProduct] = useState('');
  const [newListQty, setNewListQty] = useState('1');
  const [newListUnit, setNewListUnit] = useState('kg');
  const [newListNotes, setNewListNotes] = useState('');
  const [savingListItem, setSavingListItem] = useState(false);
  const [deletingListItemId, setDeletingListItemId] = useState<string | null>(null);
  const [listFeedback, setListFeedback] = useState<string | null>(null);

  const {
    isSupported: pushSupported,
    permission: pushPermission,
    isSubscribed: pushSubscribed,
    loading: pushLoading,
    testing: pushTesting,
    feedback: pushFeedback,
    error: pushError,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    sendTestPush,
  } = usePushNotifications(Boolean(dbUser), apiFetch);

  useEffect(() => {
    const handler = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const persistSearchHistory = useCallback((items: SearchHistoryEntry[]) => {
    setSearchHistory(items);
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items));
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const saveSearchToHistory = useCallback(
    (overrideQuery?: string) => {
      const q = (overrideQuery ?? searchQuery).trim();
      const hasCity = selectedCity !== 'Toutes les villes';
      const hasBudget = pricePreset !== 'all';
      if (q.length < 2 && !hasCity && !hasBudget) return;

      const parts: string[] = [];
      if (q) parts.push(q);
      if (hasCity) parts.push(selectedCity);
      if (activePriceLabel) parts.push(activePriceLabel);
      const label = parts.join(' · ');
      if (!label) return;

      const id = `${q.toLowerCase()}|${selectedCity}|${pricePreset}|${customMinPrice}|${customMaxPrice}`;
      const entry: SearchHistoryEntry = {
        id,
        query: q,
        city: selectedCity,
        pricePreset,
        customMinPrice,
        customMaxPrice,
        label,
        updatedAt: Date.now(),
      };

      setSearchHistory((prev) => {
        const next = [entry, ...prev.filter((item) => item.id !== id)].slice(0, 8);
        try {
          localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage restrictions
        }
        return next;
      });
    },
    [
      searchQuery,
      selectedCity,
      pricePreset,
      customMinPrice,
      customMaxPrice,
      activePriceLabel,
    ]
  );

  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      saveSearchToHistory();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [searchQuery, saveSearchToHistory]);

  const applyHistoryEntry = useCallback((entry: SearchHistoryEntry) => {
    setSearchQuery(entry.query);
    setSelectedCity(entry.city || 'Toutes les villes');
    setSelectedMarketId(null);
    setPricePreset(entry.pricePreset || 'all');
    setCustomMinPrice(entry.customMinPrice || '');
    setCustomMaxPrice(entry.customMaxPrice || '');
    setDebouncedCustomMin(entry.customMinPrice || '');
    setDebouncedCustomMax(entry.customMaxPrice || '');
    setSearchFocused(false);
  }, []);

  const removeHistoryEntry = useCallback(
    (id: string) => {
      persistSearchHistory(searchHistory.filter((item) => item.id !== id));
    },
    [searchHistory, persistSearchHistory]
  );

  const clearSearchHistory = useCallback(() => {
    persistSearchHistory([]);
  }, [persistSearchHistory]);

  useEffect(() => {
    if (dbUser) {
      setProfName(dbUser.fullName || '');
      setProfPhone(dbUser.phone || '');
    } else {
      setFavoriteShopIds([]);
      setFavoriteShopsList([]);
    }
    if (customerProfile) {
      setProfCity(customerProfile.city || 'Abidjan');
      setProfCommune(customerProfile.commune || 'Cocody');
      setProfQuartier(customerProfile.quartier || '');
      setProfAddress(customerProfile.addressLabel || '');
      setProfLat(customerProfile.lat ?? null);
      setProfLng(customerProfile.lng ?? null);
      setFavoriteShopIds(
        Array.isArray(customerProfile.favoriteShopIds) ? customerProfile.favoriteShopIds : []
      );
    }
  }, [dbUser, customerProfile]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [mRes, cRes, lRes] = await Promise.all([
        fetch(apiUrl('/api/markets')).then((r) => r.json()),
        fetch(apiUrl('/api/categories')).then((r) => r.json()),
        fetch(apiUrl('/api/lives')).then((r) => r.json()),
      ]);
      setMarkets(Array.isArray(mRes) ? mRes : []);
      setCategories(Array.isArray(cRes) ? cRes : []);
      setActiveLives(Array.isArray(lRes) ? lRes : []);
    } catch (err) {
      console.error('Failed to load markets/categories:', err);
    }
  }, []);

  const loadShops = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedCity !== 'Toutes les villes') params.set('city', selectedCity);
      if (selectedMarketId) params.set('marketId', String(selectedMarketId));
      if (selectedCategory) params.set('category', selectedCategory);
      if (liveOnly) params.set('liveOnly', 'true');
      if (activePriceBounds.minPrice !== undefined) {
        params.set('minPrice', String(activePriceBounds.minPrice));
      }
      if (activePriceBounds.maxPrice !== undefined) {
        params.set('maxPrice', String(activePriceBounds.maxPrice));
      }

      const res = await fetch(apiUrl(`/api/shops?${params.toString()}`));
      const data = await res.json();
      setShops(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load shops:', err);
    } finally {
      setLoadingFeed(false);
    }
  }, [
    searchQuery,
    selectedCity,
    selectedMarketId,
    selectedCategory,
    liveOnly,
    activePriceBounds.minPrice,
    activePriceBounds.maxPrice,
  ]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  const loadNotifications = useCallback(async () => {
    if (!dbUser) return;
    try {
      const data = await apiFetch('/api/notifications');
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // Ignore
    }
  }, [dbUser, apiFetch]);

  const loadFavoriteShops = useCallback(async () => {
    if (!dbUser) {
      setFavoriteShopsList([]);
      return;
    }
    setLoadingFavorites(true);
    try {
      const data = await apiFetch<{
        favoriteShopIds: number[];
        favoriteShops: MerchantShop[];
      }>('/api/me/favorites');
      if (Array.isArray(data.favoriteShopIds)) {
        setFavoriteShopIds(data.favoriteShopIds);
      }
      setFavoriteShopsList(Array.isArray(data.favoriteShops) ? data.favoriteShops : []);
    } catch {
      // Ignore
    } finally {
      setLoadingFavorites(false);
    }
  }, [dbUser, apiFetch]);

  useEffect(() => {
    if (view === 'profile') {
      loadNotifications();
      loadFavoriteShops();
    }
  }, [view, loadNotifications, loadFavoriteShops]);

  const toggleFavoriteShop = useCallback(
    async (shopId: number) => {
      if (!dbUser) {
        try {
          await signIn();
        } catch {
          return;
        }
      }
      const wasFavorite = favoriteShopIds.includes(shopId);
      setTogglingFavoriteId(shopId);
      setFavoriteShopIds((prev) =>
        wasFavorite ? prev.filter((id) => id !== shopId) : [shopId, ...prev]
      );
      try {
        const res = await apiFetch<{
          ok: boolean;
          isFavorite: boolean;
          favoriteShopIds: number[];
        }>(`/api/me/favorites/${shopId}`, {
          method: 'POST',
        });
        if (Array.isArray(res.favoriteShopIds)) {
          setFavoriteShopIds(res.favoriteShopIds);
        }
        await refreshProfile();
        if (view === 'profile') {
          await loadFavoriteShops();
        }
      } catch (err) {
        console.error('Failed to toggle favorite shop:', err);
        setFavoriteShopIds((prev) =>
          wasFavorite ? [shopId, ...prev] : prev.filter((id) => id !== shopId)
        );
      } finally {
        setTogglingFavoriteId(null);
      }
    },
    [dbUser, signIn, favoriteShopIds, apiFetch, refreshProfile, view, loadFavoriteShops]
  );

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setProfFeedback('Géolocalisation non prise en charge par ce navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setProfLat(pos.coords.latitude);
        setProfLng(pos.coords.longitude);
        setProfFeedback(
          `Position GPS détectée (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}).`
        );
      },
      () => {
        setProfFeedback('Autorisation de localisation refusée.');
      }
    );
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfFeedback(null);
    try {
      await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: profName,
          phone: profPhone,
          preferredLang: lang,
          city: profCity,
          commune: profCommune,
          quartier: profQuartier,
          addressLabel: profAddress,
          lat: profLat,
          lng: profLng,
        }),
      });
      await refreshProfile();
      setProfFeedback('Profil et adresse de livraison enregistrés.');
    } catch (err: unknown) {
      setProfFeedback(err instanceof Error ? err.message : 'Erreur enregistrement');
    }
  };

  const openLive = (sessionId: number, hostMode = false, viaQr = false) => {
    if (!hostMode && searchQuery.trim().length >= 2) {
      saveSearchToHistory();
    }
    setActiveLiveId(sessionId);
    setActiveLiveHostMode(hostMode);
    setActiveLiveViaQr(viaQr);
    setView('live_room');
  };

  const openShop = (shopId: number) => {
    if (searchQuery.trim().length >= 2) {
      saveSearchToHistory();
    }
    setActiveShopId(shopId);
    setView('shop_detail');
  };

  // Deep-link from push notification (?live=123), QR code (?shop=45), or Service Worker message
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const liveParam = Number(params.get('live'));
    const shopParam = Number(params.get('shop'));

    if (Number.isInteger(liveParam) && liveParam > 0) {
      setActiveLiveId(liveParam);
      setActiveLiveHostMode(false);
      setActiveLiveViaQr(false);
      setView('live_room');
      window.history.replaceState({}, '', '/');
    } else if (Number.isInteger(shopParam) && shopParam > 0) {
      window.history.replaceState({}, '', '/');
      fetch(apiUrl(`/api/shops/${shopParam}`))
        .then((r) => (r.ok ? r.json() : null))
        .then((shopData: MerchantShop | null) => {
          if (!shopData) return;
          if (shopData.activeLive && shopData.activeLive.status === 'live') {
            setActiveLiveId(shopData.activeLive.id);
            setActiveLiveHostMode(false);
            setActiveLiveViaQr(true);
            setView('live_room');
          } else {
            setActiveShopId(shopData.id);
            setView('shop_detail');
          }
        })
        .catch(() => {});
    }

    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_NOTIFICATION_CLICK') {
        const liveSessionId = Number(event.data?.data?.liveSessionId);
        if (Number.isInteger(liveSessionId) && liveSessionId > 0) {
          setActiveLiveId(liveSessionId);
          setActiveLiveHostMode(false);
          setView('live_room');
        } else {
          setView('profile');
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, []);

  // Real-time WebSocket listener for incoming notifications
  useEffect(() => {
    if (!dbUser) return;
    let closedByEffect = false;
    let dismissTimer: number | null = null;
    const ws = new WebSocket(wsUrl('/ws'));

    ws.onopen = async () => {
      try {
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          if (!closedByEffect && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'auth', payload: { token } }));
          }
        }
      } catch {
        // Ignore auth token error
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'notification:new' && msg.payload) {
          const notif = msg.payload;
          setNotifications((prev) =>
            prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev]
          );
          setLiveToast({
            id: notif.id,
            title: notif.title,
            body: notif.body,
            liveSessionId: notif.liveSessionId ?? null,
          });
          if (dismissTimer) window.clearTimeout(dismissTimer);
          dismissTimer = window.setTimeout(() => setLiveToast(null), 8000);
          refreshProfile();
        }
      } catch {
        // Ignore malformed WS message
      }
    };

    return () => {
      closedByEffect = true;
      if (dismissTimer) window.clearTimeout(dismissTimer);
      ws.close();
    };
  }, [dbUser?.id, refreshProfile]);

  const handleAddShoppingListItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListProduct.trim();
    if (trimmed.length < 2) {
      setListFeedback('Veuillez saisir un nom de produit valide.');
      return;
    }
    setSavingListItem(true);
    setListFeedback(null);
    try {
      await apiFetch('/api/me/shopping-list', {
        method: 'POST',
        body: JSON.stringify({
          productName: trimmed,
          defaultQty: Math.max(0.5, Number(newListQty) || 1),
          unitLabel: newListUnit,
          notes: newListNotes.trim() || undefined,
        }),
      });
      setNewListProduct('');
      setNewListQty('1');
      setNewListNotes('');
      await refreshProfile();
      setListFeedback('Produit ajouté à votre liste de courses.');
    } catch (err: unknown) {
      setListFeedback(err instanceof Error ? err.message : 'Erreur lors de l’ajout');
    } finally {
      setSavingListItem(false);
    }
  };

  const handleDeleteShoppingListItem = async (itemId: string) => {
    setDeletingListItemId(itemId);
    setListFeedback(null);
    try {
      await apiFetch(`/api/me/shopping-list/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      await refreshProfile();
    } catch (err: unknown) {
      setListFeedback(err instanceof Error ? err.message : 'Erreur lors de la suppression');
    } finally {
      setDeletingListItemId(null);
    }
  };

  const handleMarkNotificationRead = async (notifId: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, isRead: true } : n))
    );
    try {
      await apiFetch(`/api/notifications/${notifId}/read`, { method: 'POST' });
      await refreshProfile();
    } catch {
      // Ignore
    }
  };

  const isAdmin =
    dbUser &&
    ['super_admin', 'admin', 'support', 'finance_controller'].includes(dbUser.role);

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink pb-20 md:pb-0 transition-colors duration-200">
      {/* Google Maps Demo Key Quota Banner */}
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 dark:bg-amber-950/70 border-b border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 dark:text-amber-100 hover:text-amber-800 dark:hover:text-white"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-md border-b border-line transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4 md:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            onClick={() => setView('markets')}
            className="inline-flex items-center gap-2 text-lg md:text-xl font-extrabold tracking-tight text-brand-green-text whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MarcheLiveMark className="w-7 h-7 shrink-0" />
            <span>
              MARCHÉ <span className="text-brand-orange-text">LIVE</span>
            </span>
          </button>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-ink-secondary">
            <button
              onClick={() => setView('markets')}
              className={`whitespace-nowrap shrink-0 hover:text-brand-green-text transition-colors cursor-pointer ${
                view === 'markets' ? 'text-brand-green-text font-semibold underline underline-offset-8' : ''
              }`}
            >
              Marchés
            </button>
            <button
              onClick={() => setView('become_merchant')}
              className={`whitespace-nowrap shrink-0 hover:text-brand-green-text transition-colors cursor-pointer ${
                view === 'become_merchant'
                  ? 'text-brand-green-text font-semibold underline underline-offset-8'
                  : ''
              }`}
            >
              Devenir commerçant
            </button>
            <button
              onClick={() => setView('diaspora')}
              className={`whitespace-nowrap shrink-0 hover:text-brand-green-text transition-colors cursor-pointer ${
                view === 'diaspora' ? 'text-brand-green-text font-semibold underline underline-offset-8' : ''
              }`}
            >
              Diaspora
            </button>
            <button
              onClick={() => setView('orders')}
              className={`whitespace-nowrap shrink-0 hover:text-brand-green-text transition-colors cursor-pointer ${
                view === 'orders' ? 'text-brand-green-text font-semibold underline underline-offset-8' : ''
              }`}
            >
              Commandes
            </button>
            <button
              onClick={() => setView('admin')}
              className={`whitespace-nowrap shrink-0 hover:text-brand-green-text transition-colors cursor-pointer ${
                view === 'admin' ? 'text-brand-green-text font-semibold underline underline-offset-8' : ''
              }`}
            >
              Administration
            </button>
          </nav>

          {/* Zone 3: Install App + Theme Toggle + Primary Action */}
          <div className="shrink-0 flex items-center gap-2">
            <PWAInstallButton />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
              className="h-10 px-2.5 sm:px-3 rounded-xl border border-line bg-surface-muted hover:bg-line text-ink flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-green"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-ink-secondary" />
              )}
              <span className="hidden xl:inline">
                {theme === 'dark' ? 'Clair' : 'Sombre'}
              </span>
            </button>

            {dbUser ? (
              <button
                onClick={() => setView('profile')}
                className="h-10 px-4 text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-hover rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5" />
                <span>{dbUser.fullName?.split(' ')[0] || 'Mon compte'}</span>
                {unreadNotificationsCount > 0 && (
                  <span className="font-mono text-[11px] text-[#FACC15]">
                    ({unreadNotificationsCount})
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={signIn}
                className="h-10 px-4 text-xs font-semibold text-white bg-brand-orange hover:bg-brand-orange-hover rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Connexion
              </button>
            )}
          </div>
        </div>
      </header>

      <OfflineIndicator />

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 md:py-8 space-y-8">
        {/* Diaspora Active Banner */}
        {diasporaConfig?.enabled && view !== 'diaspora' && (
          <div className="bg-brand-green text-white rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs md:text-sm">
            <div>
              <strong>Mode Diaspora actif</strong> · Livraison pour{' '}
              {diasporaConfig.beneficiaryName} ({diasporaConfig.city}, {diasporaConfig.commune}) ·
              Devise : {diasporaConfig.currency}
            </div>
            <button
              onClick={() => setDiasporaConfig(null)}
              className="px-3 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-semibold cursor-pointer"
            >
              Désactiver
            </button>
          </div>
        )}

        {/* VIEW: MARKETS / HOME */}
        <AnimatePresence mode="wait">
          {view === 'markets' && (
            <motion.div
              key="view-markets"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              className="space-y-10"
            >
              {/* Hero Split */}
              <FadeSection className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-surface border border-line rounded-2xl overflow-hidden">
              <div className="lg:col-span-6 p-6 md:p-10 flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-brand-green-text">
                    Côte d'Ivoire · Abidjan & Régions · Paiement FCFA (XOF)
                  </div>
                  <h1 className="text-3xl md:text-5xl font-extrabold text-ink leading-[1.1] [text-wrap:balance]">
                    Le vrai marché, en direct chez vous !
                  </h1>
                  <p className="text-sm md:text-base text-ink-secondary leading-relaxed max-w-xl">
                    {lang === 'nouchi'
                      ? 'Regarde les commerçants en direct sur leur étal, choisis tes vivriers frais sans palabre et fais-toi gbé jusqu’à la maison.'
                      : 'Connectez-vous en vidéo LIVE avec les commerçants des vrais marchés ivoiriens, choisissez vos marchandises en direct et recevez votre commande à domicile.'}
                  </p>
                </div>

                {/* Search & Location Toolbar */}
                <div className="space-y-3">
                  <div className="space-y-2.5" ref={searchContainerRef}>
                    <div className="relative">
                      <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onFocus={() => setSearchFocused(true)}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveSearchToHistory();
                            setSearchFocused(false);
                          } else if (e.key === 'Escape') {
                            setSearchFocused(false);
                          }
                        }}
                        placeholder="Produit, marché, commerçant, ville..."
                        aria-label="Rechercher un produit, marché, commerçant ou ville"
                        className="w-full pl-10 pr-9 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted focus:bg-surface focus:outline-none focus:border-brand-green"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          aria-label="Effacer la recherche"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {searchFocused && searchHistory.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-surface border border-line rounded-xl shadow-lg overflow-hidden">
                          <div className="flex items-center justify-between px-3.5 py-2 border-b border-line bg-surface-subtle">
                            <span className="text-[11px] font-semibold text-ink-muted flex items-center gap-1.5">
                              <History className="w-3.5 h-3.5 text-brand-green-text" />
                              Historique de recherche
                            </span>
                            <button
                              type="button"
                              onClick={clearSearchHistory}
                              className="text-[11px] font-semibold text-brand-orange-text hover:underline cursor-pointer"
                            >
                              Tout effacer
                            </button>
                          </div>
                          <ul className="divide-y divide-line max-h-60 overflow-y-auto">
                            {searchHistory.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2 px-3.5 py-2 hover:bg-surface-subtle transition-colors"
                              >
                                <button
                                  type="button"
                                  onClick={() => applyHistoryEntry(item)}
                                  className="flex-1 text-left text-xs text-ink font-medium truncate flex items-center gap-2 cursor-pointer"
                                >
                                  <History className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                                  <span className="truncate">{item.label}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeHistoryEntry(item.id)}
                                  aria-label={`Supprimer ${item.label} de l'historique`}
                                  className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted cursor-pointer shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="relative">
                        <MapPin className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          value={selectedCity}
                          onChange={(e) => {
                            setSelectedCity(e.target.value);
                            setSelectedMarketId(null);
                          }}
                          className="w-full pl-9 pr-3 py-2.5 text-sm border border-line rounded-xl bg-surface text-ink font-medium focus:outline-none focus:border-brand-green"
                          aria-label="Filtrer par ville"
                        >
                          {CITIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="relative">
                        <Banknote className="w-4 h-4 text-brand-green-text absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          value={pricePreset}
                          onChange={(e) => setPricePreset(e.target.value as PricePresetId)}
                          className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-surface font-medium focus:outline-none focus:border-brand-green ${
                            pricePreset !== 'all'
                              ? 'border-brand-green text-brand-green-text'
                              : 'border-line text-ink'
                          }`}
                          aria-label="Filtrer par tranche de prix"
                        >
                          {PRICE_RANGES.map((range) => (
                            <option key={range.id} value={range.id}>
                              {range.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {pricePreset === 'custom' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-surface-subtle border border-line">
                        <div>
                          <label
                            htmlFor="filter-min-price"
                            className="block text-[11px] font-semibold text-ink-secondary mb-1"
                          >
                            Prix minimum (FCFA)
                          </label>
                          <div className="relative">
                            <input
                              id="filter-min-price"
                              type="number"
                              min={0}
                              step={100}
                              value={customMinPrice}
                              onChange={(e) => setCustomMinPrice(e.target.value)}
                              placeholder="Ex: 500"
                              className="w-full px-3 py-2 pr-14 text-sm font-mono border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-green tabular-nums"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-ink-muted pointer-events-none">
                              FCFA
                            </span>
                          </div>
                        </div>
                        <div>
                          <label
                            htmlFor="filter-max-price"
                            className="block text-[11px] font-semibold text-ink-secondary mb-1"
                          >
                            Prix maximum (FCFA)
                          </label>
                          <div className="relative">
                            <input
                              id="filter-max-price"
                              type="number"
                              min={0}
                              step={100}
                              value={customMaxPrice}
                              onChange={(e) => setCustomMaxPrice(e.target.value)}
                              placeholder="Ex: 5 000"
                              className="w-full px-3 py-2 pr-14 text-sm font-mono border border-line rounded-lg bg-surface text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-green tabular-nums"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-ink-muted pointer-events-none">
                              FCFA
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {searchHistory.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] font-semibold text-ink-muted inline-flex items-center gap-1 mr-0.5">
                          <History className="w-3 h-3" />
                          Récents :
                        </span>
                        {searchHistory.slice(0, 4).map((item) => (
                          <div
                            key={item.id}
                            className="inline-flex items-center rounded-lg border border-line bg-surface-subtle hover:bg-surface-muted text-[11px] text-ink-secondary transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => applyHistoryEntry(item)}
                              className="px-2 py-1 font-medium hover:text-ink truncate max-w-[180px] cursor-pointer"
                            >
                              {item.label}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeHistoryEntry(item.id)}
                              aria-label={`Supprimer ${item.label}`}
                              className="pr-1.5 pl-0.5 py-1 text-ink-muted hover:text-ink cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={clearSearchHistory}
                          className="text-[11px] font-semibold text-ink-muted hover:text-brand-orange-text ml-1 cursor-pointer"
                        >
                          Effacer
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setLiveOnly(!liveOnly)}
                        className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer ${
                          liveOnly
                            ? 'bg-red-600 text-white'
                            : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/60 hover:bg-red-100 dark:hover:bg-red-950/80'
                        }`}
                      >
                        <Radio className="w-3.5 h-3.5" />
                        <span>LIVE ({activeLives.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrScannerOpen(true)}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-brand-orange text-white hover:bg-brand-orange-hover flex items-center gap-1.5 cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Scanner QR</span>
                      </button>
                      <button
                        onClick={() => setView('merchant_space')}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-brand-green text-white hover:bg-brand-green-hover cursor-pointer"
                      >
                        Espace Commerçant(e)
                      </button>
                      <button
                        onClick={() => setView('diaspora')}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-surface-muted text-ink hover:bg-line cursor-pointer"
                      >
                        Acheter pour ma famille
                      </button>
                    </div>

                    <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-lg text-xs">
                      <button
                        onClick={() => setLang('fr')}
                        className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                          lang === 'fr' ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary'
                        }`}
                      >
                        Français
                      </button>
                      <button
                        onClick={() => setLang('nouchi')}
                        className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                          lang === 'nouchi' ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary'
                        }`}
                      >
                        Nouchi
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 relative min-h-[260px] lg:min-h-[380px] bg-surface-muted">
                <img
                  src="/src/assets/images/hero_abidjan_market_1795179888442.jpg"
                  alt="Marché frais à Abidjan, Côte d'Ivoire"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </FadeSection>

            {/* Category Navigation & Visual Rayons */}
            <FadeSection delay={0.05} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold text-ink">Rayons des marchés</h2>
                {selectedCategory && (
                  <button
                    onClick={() => setSelectedCategory('')}
                    className="text-xs font-semibold text-brand-orange-text hover:underline cursor-pointer"
                  >
                    Tout afficher
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
                    selectedCategory === ''
                      ? 'bg-brand-green text-white border-brand-green'
                      : 'bg-surface text-ink-secondary border-line hover:border-line-strong'
                  }`}
                >
                  Tous les produits
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.slug)}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
                      selectedCategory === cat.slug
                        ? 'bg-brand-green text-white border-brand-green'
                        : 'bg-surface text-ink-secondary border-line hover:border-line-strong'
                    }`}
                  >
                    {lang === 'nouchi' && cat.nameNouchi ? cat.nameNouchi : cat.nameFr}
                  </button>
                ))}
              </div>

              {/* 2 Visual Category Spotlights */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <button
                  onClick={() => setSelectedCategory('poissons')}
                  className="group text-left bg-surface border border-line rounded-2xl overflow-hidden grid grid-cols-12 items-stretch hover:border-brand-green transition-colors cursor-pointer"
                >
                  <div className="col-span-5 bg-slate-900">
                    <img
                      src="/src/assets/images/category_fresh_fish_1795179889296.jpg"
                      alt="Poissons frais du jour"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover min-h-[140px]"
                    />
                  </div>
                  <div className="col-span-7 p-5 flex flex-col justify-center">
                    <div className="text-xs text-brand-green-text font-semibold">Rayon Marée & Lagune</div>
                    <div className="text-lg font-bold text-ink mt-1">
                      Poissons, crustacés & fumés
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      Treichville · Attécoubé · San Pedro
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedCategory('legumes')}
                  className="group text-left bg-surface border border-line rounded-2xl overflow-hidden grid grid-cols-12 items-stretch hover:border-brand-orange transition-colors cursor-pointer"
                >
                  <div className="col-span-5 bg-surface-muted">
                    <img
                      src="/src/assets/images/category_tropical_produce_1795179889624.jpg"
                      alt="Vivriers, légumes et fruits tropicaux"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover min-h-[140px]"
                    />
                  </div>
                  <div className="col-span-7 p-5 flex flex-col justify-center">
                    <div className="text-xs text-brand-orange-text font-semibold">Rayon Vivriers & Champs</div>
                    <div className="text-lg font-bold text-ink mt-1">
                      Légumes, plantains & condiments
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      Marché Gouro · Cocody · Bouaké
                    </div>
                  </div>
                </button>
              </div>
            </FadeSection>

            {/* Live Sessions & Registered Merchants */}
            <FadeSection delay={0.09} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-ink">
                    Commerçants disponibles & directs en cours
                  </h2>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {selectedMarketId
                      ? `Filtré sur : ${markets.find((m) => m.id === selectedMarketId)?.name}`
                      : activePriceLabel
                        ? `Produits correspondant au budget : ${activePriceLabel}`
                        : 'Classement en temps réel depuis la base de données PostgreSQL'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {(dbUser || favoriteShopIds.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setFavoritesOnly((prev) => !prev)}
                      aria-pressed={favoritesOnly}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                        favoritesOnly
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-surface border-line text-ink hover:border-line-strong'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          favoritesOnly ? 'fill-white text-white' : 'text-red-500'
                        }`}
                      />
                      <span>Favoris ({favoriteShopIds.length})</span>
                    </button>
                  )}
                  {activePriceLabel && (
                    <button
                      type="button"
                      onClick={clearPriceFilter}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-brand-green/50 text-xs font-semibold text-brand-green-text hover:bg-surface-muted cursor-pointer"
                    >
                      <span>Budget : {activePriceLabel}</span>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {selectedMarketId && (
                    <button
                      onClick={() => setSelectedMarketId(null)}
                      className="text-xs font-semibold text-brand-green-text hover:underline cursor-pointer"
                    >
                      Voir tous les marchés
                    </button>
                  )}
                  <div className="relative">
                    <ArrowUpDown className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as ShopSortOption)}
                      aria-label="Trier les boutiques"
                      className={`pl-8 pr-3 py-2 text-xs font-semibold rounded-xl border bg-surface focus:outline-none focus:border-brand-green cursor-pointer ${
                        sortBy !== 'relevance'
                          ? 'border-brand-green text-brand-green-text'
                          : 'border-line text-ink'
                      }`}
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {loadingFeed ? (
                  <motion.div
                    key="feed-skeleton"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <MerchantGridSkeleton count={6} />
                  </motion.div>
                ) : displayedShops.length === 0 ? (
                  <motion.div
                    key="feed-empty"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                    className="bg-surface border border-line rounded-2xl p-8 text-center space-y-3"
                  >
                    <Store className="w-9 h-9 text-brand-green-text mx-auto" />
                    <h3 className="text-base font-bold text-ink">
                      {favoritesOnly
                        ? 'Aucun commerçant favori ne correspond à ces critères'
                        : 'Aucun commerçant enregistré pour ces critères'}
                    </h3>
                    <p className="text-sm text-ink-secondary max-w-lg mx-auto">
                      {favoritesOnly
                        ? 'Cliquez sur le cœur d’une boutique pour l’ajouter à vos commerçants préférés.'
                        : "MARCHÉ LIVE n'affiche aucun commerçant fictif. Créez une vraie boutique dans l'Espace Commerçant(e) et démarrez un LIVE pour tester en direct avec deux appareils."}
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                      <button
                        onClick={() => setView('merchant_space')}
                        className="px-5 py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
                      >
                        Créer une boutique réelle
                      </button>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCity('Toutes les villes');
                          setSelectedMarketId(null);
                          setSelectedCategory('');
                          setLiveOnly(false);
                          setFavoritesOnly(false);
                          setSortBy('relevance');
                          clearPriceFilter();
                        }}
                        className="px-4 py-2.5 bg-surface-muted hover:bg-line text-ink text-xs font-semibold rounded-xl cursor-pointer"
                      >
                        Réinitialiser les filtres
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="feed-grid"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                  >
                    {displayedShops.map(({ shop, allShopProducts, previewProducts, minPriceXof, maxPriceXof }, index) => {
                      const lq = searchQuery.trim().toLowerCase();
                      const showProductPreview =
                        (hasPriceFilter || Boolean(lq)) && previewProducts.length > 0;
                      const isFavorite = favoriteShopIds.includes(shop.id);

                      return (
                        <StaggerCard
                          key={shop.id}
                          index={index}
                          className="bg-surface border border-line rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-line-strong transition-colors"
                        >
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                            <span className="truncate">
                              {shop.market.name} · {shop.market.city}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {shop.isStarMerchant && (
                                <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
                                  <Award className="w-3.5 h-3.5 text-[#EAB308]" />
                                  Star
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleFavoriteShop(shop.id)}
                                disabled={togglingFavoriteId === shop.id}
                                aria-label={
                                  isFavorite
                                    ? `Retirer ${shop.shopName} des favoris`
                                    : `Ajouter ${shop.shopName} aux favoris`
                                }
                                aria-pressed={isFavorite}
                                title={
                                  isFavorite ? 'Retirer des favoris' : 'Sauvegarder en favori'
                                }
                                className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors cursor-pointer disabled:opacity-60 ${
                                  isFavorite
                                    ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900/60 text-red-500'
                                    : 'bg-surface-subtle border-line text-ink-muted hover:text-red-500 hover:border-red-200 dark:hover:border-red-900/60'
                                }`}
                              >
                                <Heart
                                  className={`w-4 h-4 ${
                                    isFavorite ? 'fill-red-500 text-red-500' : ''
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                          <h3 className="text-lg font-bold text-ink">{shop.shopName}</h3>
                          <div className="text-xs text-ink-secondary tabular-nums">
                            Note {shop.ratingAvg}/5 · {shop.completedOrdersCount} commandes ·{' '}
                            {allShopProducts.length} produit(s)
                            {sortBy === 'price_asc' && minPriceXof !== null && (
                              <span className="text-brand-green-text font-semibold">
                                {' '}· À partir de {minPriceXof.toLocaleString('fr-FR')} FCFA
                              </span>
                            )}
                            {sortBy === 'price_desc' && maxPriceXof !== null && (
                              <span className="text-brand-green-text font-semibold">
                                {' '}· Jusqu’à {maxPriceXof.toLocaleString('fr-FR')} FCFA
                              </span>
                            )}
                          </div>

                          {showProductPreview && (
                            <div className="bg-surface-subtle border border-line rounded-xl p-2.5 space-y-1.5">
                              <div className="text-[11px] font-semibold text-ink-muted">
                                {hasPriceFilter
                                  ? `${previewProducts.length} produit(s) dans votre budget`
                                  : 'Produits correspondants'}
                              </div>
                              {previewProducts.slice(0, 3).map((prod) => (
                                <div
                                  key={prod.id}
                                  className="flex items-center justify-between gap-2 text-xs"
                                >
                                  <span className="text-ink truncate">{prod.name}</span>
                                  <span className="font-mono font-semibold text-brand-green-text whitespace-nowrap tabular-nums">
                                    {prod.unitPriceXof.toLocaleString('fr-FR')} F/{prod.unitLabel}
                                  </span>
                                </div>
                              ))}
                              {previewProducts.length > 3 && (
                                <div className="text-[11px] font-medium text-brand-orange-text">
                                  + {previewProducts.length - 3} autre(s) produit(s)
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-line">
                          {shop.activeLive ? (
                            <button
                              onClick={() => openLive(shop.activeLive!.id, false)}
                              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Radio className="w-3.5 h-3.5" />
                              <span>LIVE ({shop.activeLive.viewerCount})</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => openShop(shop.id)}
                              className="flex-1 py-2.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
                            >
                              Voir l'étal
                            </button>
                          )}
                          <button
                            onClick={() => openShop(shop.id)}
                            className="px-3.5 py-2.5 bg-surface-muted hover:bg-line text-ink text-xs font-semibold rounded-xl cursor-pointer"
                          >
                            Catalogue
                          </button>
                        </div>
                      </StaggerCard>
                    );
                  })}
                </motion.div>
              )}
              </AnimatePresence>
            </FadeSection>

            {/* Interactive Côte d'Ivoire Markets Map */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.08 }}
              transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold text-ink">
                  Carte des marchés couverts en Côte d'Ivoire ({markets.length})
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Abidjan (Cocody, Angré, Gouro, Adjamé, Marcory, Treichville, Abobo, Yopougon, Koumassi, Attécoubé) et grandes villes. Cliquez sur un repère pour filtrer.
                </p>
              </div>
              <MarketDeliveryMap
                markets={markets}
                selectedMarketId={selectedMarketId}
                onSelectMarket={(m) => setSelectedMarketId(m.id)}
              />
            </motion.section>
          </motion.div>
        )}

        {/* VIEW: DEVENIR COMMERÇANT(E) + SIMULATOR */}
        {view === 'become_merchant' && (
          <motion.div
            key="view-become-merchant"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="space-y-8"
          >
            <EarningsSimulator onStartMerchant={() => setView('merchant_space')} />
          </motion.div>
        )}

        {/* VIEW: MERCHANT WORKSPACE */}
        {view === 'merchant_space' && (
          <motion.div
            key="view-merchant-space"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <MerchantWorkspace
              markets={markets}
              categories={categories}
              onJoinLiveAsHost={(sid) => openLive(sid, true)}
            />
          </motion.div>
        )}

        {/* VIEW: LIVE ROOM */}
        {view === 'live_room' && activeLiveId && (
          <motion.div
            key={`view-live-${activeLiveId}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <LiveRoom
              sessionId={activeLiveId}
              isHostMode={activeLiveHostMode}
              joinedViaQr={activeLiveViaQr}
              diasporaConfig={diasporaConfig}
              onClose={() => {
                setActiveLiveViaQr(false);
                setView(activeLiveHostMode ? 'merchant_space' : 'markets');
              }}
              onOrderCreated={(orderId) => {
                setFocusOrderId(orderId);
                setView('orders');
              }}
            />
          </motion.div>
        )}

        {/* VIEW: SHOP DETAIL */}
        {view === 'shop_detail' && activeShopId && (
          <motion.div
            key={`view-shop-${activeShopId}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <ShopDetailView
              shopId={activeShopId}
              priceFilter={hasPriceFilter ? activePriceBounds : null}
              isFavorite={favoriteShopIds.includes(activeShopId)}
              onToggleFavorite={toggleFavoriteShop}
              diasporaConfig={diasporaConfig}
              onBack={() => setView('markets')}
              onWatchLive={(sid) => openLive(sid, false)}
              onOrderCreated={(orderId) => {
                setFocusOrderId(orderId);
                setView('orders');
              }}
            />
          </motion.div>
        )}

        {/* VIEW: DIASPORA */}
        {view === 'diaspora' && (
          <motion.div
            key="view-diaspora"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <DiasporaHub
              onActivateDiasporaOrder={(cfg) => {
                setDiasporaConfig(cfg);
                setView('markets');
              }}
            />
          </motion.div>
        )}

        {/* VIEW: ORDERS & TRACKING */}
        {view === 'orders' && (
          <motion.div
            key="view-orders"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <OrdersAndTracking focusOrderId={focusOrderId} />
          </motion.div>
        )}

        {/* VIEW: ADMIN */}
        {view === 'admin' && (
          <motion.div
            key="view-admin"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            <AdminDashboard />
          </motion.div>
        )}

        {/* VIEW: PROFILE & NOTIFICATIONS */}
        {view === 'profile' && dbUser && (
          <motion.div
            key="view-profile"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
          >
            <div className="lg:col-span-7 space-y-6">
              <form
                onSubmit={handleSaveProfile}
                className="bg-surface border border-line rounded-2xl p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-ink">Mon profil & adresses</h2>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    Se déconnecter
                  </button>
                </div>
                <div className="text-xs text-ink-muted">
                  E-mail : {dbUser.email} · Rôle : <span className="font-mono">{dbUser.role}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">
                      Nom complet
                    </label>
                    <input
                      type="text"
                      value={profName}
                      onChange={(e) => setProfName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={profPhone}
                      onChange={(e) => setProfPhone(e.target.value)}
                      placeholder="+225 07..."
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">Ville</label>
                    <input
                      type="text"
                      value={profCity}
                      onChange={(e) => setProfCity(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">Commune</label>
                    <input
                      type="text"
                      value={profCommune}
                      onChange={(e) => setProfCommune(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">
                      Quartier
                    </label>
                    <input
                      type="text"
                      value={profQuartier}
                      onChange={(e) => setProfQuartier(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">
                      Repère / Adresse
                    </label>
                    <input
                      type="text"
                      value={profAddress}
                      onChange={(e) => setProfAddress(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleDetectLocation}
                    className="px-4 py-2 bg-surface-muted hover:bg-line text-ink text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Compass className="w-4 h-4 text-brand-green-text" />
                    <span>Localisation automatique (GPS)</span>
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Enregistrer mon profil
                  </button>
                </div>
                {profFeedback && <p className="text-xs text-brand-green-text font-medium">{profFeedback}</p>}

                <div className="pt-4 border-t border-line flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setView('merchant_space')}
                    className="px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Accéder à l'Espace Commerçant(e)
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setView('admin')}
                      className="px-4 py-2 bg-ink text-canvas text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Administration</span>
                    </button>
                  )}
                </div>
              </form>

              {/* Recurring Shopping List ("Liste de courses") */}
              <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-ink flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-brand-green-text" />
                    <span>
                      Ma liste de courses ({customerProfile?.shoppingList?.length || 0})
                    </span>
                  </h3>
                  <p className="text-xs text-ink-muted mt-1">
                    Pré-enregistrez vos produits habituels pour les ajouter au panier en 1 clic pendant un LIVE ou les demander au commerçant à la caméra.
                  </p>
                </div>

                <form onSubmit={handleAddShoppingListItem} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <input
                    type="text"
                    value={newListProduct}
                    onChange={(e) => setNewListProduct(e.target.value)}
                    placeholder="Produit récurrent (ex: Tomates fraîches, Attiéké)"
                    className="sm:col-span-5 px-3 py-2 text-xs border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={newListQty}
                    onChange={(e) => setNewListQty(e.target.value)}
                    aria-label="Quantité par défaut"
                    className="sm:col-span-2 px-3 py-2 text-xs font-mono border border-line rounded-xl bg-surface-subtle text-ink text-center"
                  />
                  <select
                    value={newListUnit}
                    onChange={(e) => setNewListUnit(e.target.value)}
                    aria-label="Unité"
                    className="sm:col-span-2 px-2.5 py-2 text-xs border border-line rounded-xl bg-surface-subtle text-ink"
                  >
                    <option value="kg">kg</option>
                    <option value="tas">tas</option>
                    <option value="panier">panier</option>
                    <option value="unité">unité</option>
                    <option value="litre">litre</option>
                    <option value="sac">sac</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingListItem}
                    className="sm:col-span-3 px-3 py-2 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{savingListItem ? 'Ajout...' : 'Ajouter'}</span>
                  </button>
                  <input
                    type="text"
                    value={newListNotes}
                    onChange={(e) => setNewListNotes(e.target.value)}
                    placeholder="Précision optionnelle (ex: bien mûres, sans piment...)"
                    className="sm:col-span-12 px-3 py-2 text-xs border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
                  />
                </form>

                {listFeedback && (
                  <p className="text-xs text-brand-green-text font-medium">{listFeedback}</p>
                )}

                {!customerProfile?.shoppingList || customerProfile.shoppingList.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    Votre liste de courses est vide. Ajoutez vos produits fréquents ci-dessus.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {customerProfile.shoppingList.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl border border-line bg-surface-subtle flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink truncate">
                              {item.productName}
                            </span>
                            <span className="text-xs font-mono font-semibold text-brand-green-text shrink-0">
                              {item.defaultQty} {item.unitLabel}
                            </span>
                          </div>
                          {item.notes && (
                            <p className="text-[11px] text-ink-muted truncate mt-0.5">
                              {item.notes}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={deletingListItemId === item.id}
                          onClick={() => handleDeleteShoppingListItem(item.id)}
                          aria-label={`Supprimer ${item.productName}`}
                          className="p-1.5 rounded-lg text-ink-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-surface-muted cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              <div className="bg-surface border border-line rounded-2xl p-6 space-y-3">
                <h3 className="text-base font-bold text-ink flex items-center gap-2">
                  <Heart className="w-4 h-4 fill-red-500 text-red-500" />
                  <span>Mes commerçants favoris ({favoriteShopsList.length})</span>
                </h3>
                {loadingFavorites ? (
                  <p className="text-xs text-ink-muted">Chargement des favoris...</p>
                ) : favoriteShopsList.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    Aucun commerçant favori enregistré. Cliquez sur le cœur d'une boutique pour la retrouver ici rapidement.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-80 overflow-y-auto">
                    {favoriteShopsList.map((favShop) => (
                      <div
                        key={favShop.id}
                        className="p-3 rounded-xl border border-line bg-surface-subtle flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-ink truncate">
                            {favShop.shopName}
                          </div>
                          <div className="text-[11px] text-ink-muted truncate">
                            {favShop.market?.name} · {favShop.market?.city} · Note {favShop.ratingAvg}/5
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {favShop.activeLive && (
                            <button
                              type="button"
                              onClick={() => openLive(favShop.activeLive!.id, false)}
                              className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg cursor-pointer"
                            >
                              LIVE
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openShop(favShop.id)}
                            className="px-2.5 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-[11px] font-semibold rounded-lg cursor-pointer"
                          >
                            Voir
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleFavoriteShop(favShop.id)}
                            aria-label={`Retirer ${favShop.shopName} des favoris`}
                            className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-500 hover:bg-red-100 dark:hover:bg-red-950/80 cursor-pointer"
                          >
                            <Heart className="w-3.5 h-3.5 fill-red-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
                <h3 className="text-base font-bold text-ink flex items-center gap-2">
                  <Bell className="w-4 h-4 text-brand-orange-text" />
                  <span>Notifications ({notifications.length})</span>
                </h3>

                {/* Web Push Controls */}
                <div className="p-3.5 rounded-xl border border-line bg-surface-subtle space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                        <BellRing className="w-3.5 h-3.5 text-brand-green-text" />
                        <span>Alertes Push sur cet appareil</span>
                      </div>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        Soyez prévenu dès qu’un commerçant favori démarre un LIVE ou quand votre commande avance.
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                        pushSubscribed
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : pushPermission === 'denied'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-surface-muted text-ink-secondary'
                      }`}
                    >
                      {!pushSupported
                        ? 'Non supporté'
                        : pushSubscribed
                          ? 'Actives'
                          : pushPermission === 'denied'
                            ? 'Bloquées'
                            : 'Inactives'}
                    </span>
                  </div>

                  {pushSupported && (
                    <div className="flex flex-wrap items-center gap-2">
                      {pushSubscribed ? (
                        <button
                          type="button"
                          disabled={pushLoading}
                          onClick={unsubscribePush}
                          className="px-3 py-1.5 bg-surface border border-line-strong hover:bg-surface-muted text-ink-secondary text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {pushLoading ? 'Mise à jour...' : 'Désactiver le push'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pushLoading || pushPermission === 'denied'}
                          onClick={subscribePush}
                          className="px-3 py-1.5 bg-brand-green hover:bg-brand-green-hover text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {pushLoading ? 'Activation...' : 'Activer les notifications push'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={pushTesting}
                        onClick={sendTestPush}
                        className="px-3 py-1.5 bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange-text text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" />
                        <span>{pushTesting ? 'Envoi...' : 'Tester'}</span>
                      </button>
                    </div>
                  )}

                  {pushFeedback && (
                    <p className="text-[11px] text-brand-green-text font-medium">{pushFeedback}</p>
                  )}
                  {pushError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">{pushError}</p>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <p className="text-xs text-ink-muted">Aucune notification pour le moment.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          if (!n.isRead) handleMarkNotificationRead(n.id);
                        }}
                        className={`w-full text-left p-3 rounded-xl border text-xs transition-colors cursor-pointer ${
                          n.isRead
                            ? 'border-line bg-surface-subtle opacity-80'
                            : 'border-brand-orange/40 bg-orange-50/50 dark:bg-orange-950/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-ink">{n.title}</span>
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-brand-orange shrink-0" />
                          )}
                        </div>
                        <div className="text-ink-secondary mt-0.5">{n.body}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-surface mt-12 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-muted">
          <div className="flex items-center gap-2">
            <MarcheLiveMark className="w-5 h-5 shrink-0" />
            <span>
              <strong className="text-brand-green-text">MARCHÉ LIVE</strong> · Le vrai marché, en direct chez vous ! · Côte d'Ivoire
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={() => setView('become_merchant')} className="hover:text-ink cursor-pointer">
              Simulateur gains
            </button>
            <button onClick={() => setView('merchant_space')} className="hover:text-ink cursor-pointer">
              Espace Commerçant(e)
            </button>
            <button onClick={() => setView('diaspora')} className="hover:text-ink cursor-pointer">
              Espace Diaspora
            </button>
            <button onClick={() => setView('admin')} className="hover:text-ink cursor-pointer">
              Back-office
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar (<= 15% viewport height) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-line grid grid-cols-5 h-16">
        <button
          onClick={() => setView('markets')}
          className={`flex flex-col items-center justify-center text-[10px] font-medium cursor-pointer ${
            view === 'markets' ? 'text-brand-green-text font-bold' : 'text-ink-muted'
          }`}
        >
          <MapPin className="w-5 h-5 mb-0.5" />
          <span>Marchés</span>
        </button>
        <button
          onClick={() => {
            setView('markets');
            setLiveOnly(true);
          }}
          className={`flex flex-col items-center justify-center text-[10px] font-medium whitespace-nowrap cursor-pointer ${
            liveOnly && view === 'markets' ? 'text-red-600 dark:text-red-400 font-bold' : 'text-ink-muted'
          }`}
        >
          <Radio className="w-5 h-5 mb-0.5" />
          <span>LIVE</span>
        </button>
        <button
          type="button"
          onClick={() => setQrScannerOpen(true)}
          aria-label="Scanner le QR code d'une boutique"
          className="flex flex-col items-center justify-center text-[10px] font-bold text-brand-green-text whitespace-nowrap cursor-pointer"
        >
          <span className="w-9 h-7 rounded-xl bg-brand-green text-white flex items-center justify-center mb-0.5 shadow-sm">
            <QrCode className="w-4 h-4" />
          </span>
          <span>Scanner QR</span>
        </button>
        <button
          onClick={() => setView('merchant_space')}
          className={`flex flex-col items-center justify-center text-[10px] font-medium whitespace-nowrap cursor-pointer ${
            view === 'merchant_space' || view === 'become_merchant'
              ? 'text-brand-orange-text font-bold'
              : 'text-ink-muted'
          }`}
        >
          <Store className="w-5 h-5 mb-0.5" />
          <span>Vendre</span>
        </button>
        <button
          onClick={() => setView('orders')}
          className={`flex flex-col items-center justify-center text-[10px] font-medium whitespace-nowrap cursor-pointer ${
            view === 'orders' ? 'text-brand-green-text font-bold' : 'text-ink-muted'
          }`}
        >
          <Package className="w-5 h-5 mb-0.5" />
          <span>Commandes</span>
        </button>
      </nav>

      {/* QR Code Scanner Modal */}
      <QRScannerModal
        open={qrScannerOpen}
        favoriteShopIds={favoriteShopIds}
        onClose={() => setQrScannerOpen(false)}
        onJoinLive={(sid, viaQr = true) => openLive(sid, false, viaQr)}
        onOpenShop={(shopId) => openShop(shopId)}
        onToggleFavorite={(shopId) => toggleFavoriteShop(shopId)}
      />

      {/* Real-time Notification Toast */}
      <AnimatePresence>
        {liveToast && (
          <motion.div
            key={liveToast.id}
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="fixed bottom-20 md:bottom-6 right-4 z-50 max-w-sm bg-surface border border-brand-green/40 shadow-xl rounded-2xl p-4 flex items-start gap-3"
          >
            <BellRing className="w-5 h-5 text-brand-orange-text shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-ink">{liveToast.title}</div>
              <div className="text-xs text-ink-secondary mt-0.5 line-clamp-2">{liveToast.body}</div>
              {liveToast.liveSessionId ? (
                <button
                  type="button"
                  onClick={() => {
                    const sid = liveToast.liveSessionId!;
                    setLiveToast(null);
                    openLive(sid, false);
                  }}
                  className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg cursor-pointer"
                >
                  Rejoindre le LIVE
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setLiveToast(null)}
              aria-label="Fermer la notification"
              className="p-1 text-ink-muted hover:text-ink cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <MarcheLiveApp />
      </AuthProvider>
    </MotionConfig>
  );
}
