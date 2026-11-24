export type UserRole =
  | 'customer'
  | 'merchant'
  | 'super_admin'
  | 'admin'
  | 'support'
  | 'finance_controller';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  preferredLang: 'fr' | 'nouchi';
}

export interface SavedAddress {
  id: string;
  label: string;
  city: string;
  commune: string;
  quartier: string;
  recipientName?: string;
  recipientPhone?: string;
  lat?: number;
  lng?: number;
}

export interface ShoppingListItem {
  id: string;
  productName: string;
  defaultQty: number;
  unitLabel: string;
  notes?: string;
}

export interface CustomerProfile {
  id: number;
  userId: number;
  city: string | null;
  commune: string | null;
  quartier: string | null;
  addressLabel: string | null;
  deliveryNotes: string | null;
  lat: number | null;
  lng: number | null;
  isDiaspora: boolean;
  diasporaCountry: string | null;
  preferredCurrency: string;
  savedAddresses: SavedAddress[];
  favoriteShopIds?: number[];
  shoppingList?: ShoppingListItem[];
}

export interface Market {
  id: number;
  name: string;
  city: string;
  commune: string;
  address: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
  description: string | null;
}

export interface ProductCategory {
  id: number;
  slug: string;
  nameFr: string;
  nameNouchi: string | null;
  sortOrder: number;
}

export interface Product {
  id: number;
  shopId: number;
  categoryId: number;
  categorySlug?: string;
  category?: ProductCategory;
  name: string;
  description: string | null;
  unitLabel: string;
  unitPriceXof: number;
  stockQty: number;
  isAvailable: boolean;
  photoUrl: string | null;
}

export interface LiveSession {
  id: number;
  shopId: number;
  hostUserId: number;
  title: string;
  status: 'live' | 'ended';
  cameraFacing: 'user' | 'environment';
  videoQuality: string;
  viewerCount: number;
  startedAt: string;
  endedAt?: string | null;
}

export interface MerchantShop {
  id: number;
  merchantProfileId: number;
  marketId: number;
  shopName: string;
  photoUrl: string | null;
  stallLocation: string | null;
  categories: string[];
  openingHours: string;
  isStarMerchant: boolean;
  starReason: string | null;
  ratingAvg: number;
  reviewCount: number;
  completedOrdersCount: number;
  cancelledOrdersCount: number;
  priceRespectRate: number;
  isOnline: boolean;
  isApproved: boolean;
  market: Market;
  activeLive?: LiveSession | null;
  products?: Product[];
}

export interface LiveMessage {
  id: number;
  sessionId: number;
  userId: number;
  senderName: string;
  messageType: 'chat' | 'product_request' | 'system';
  content: string;
  createdAt: string;
}

export interface CartItem {
  id: number;
  cartId: number;
  productId: number;
  productName: string;
  quantityOrWeight: number;
  unitLabel: string;
  originalUnitPriceXof: number;
  proposedUnitPriceXof: number | null;
  unitPriceXof: number;
  totalPriceXof: number;
  priceProposalStatus: 'confirmed' | 'pending_customer_approval' | 'rejected';
  customerConfirmed: boolean;
  notes: string | null;
}

export interface DeliveryRequest {
  id: number;
  orderId: number;
  provider: 'yango_delivery' | 'manual_courier';
  externalClaimId: string | null;
  status: string;
  quotedPriceXof: number | null;
  currency: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  courierName: string | null;
  courierPhone: string | null;
  customerDecision: 'pending' | 'accepted' | 'rejected';
}

export interface Payment {
  id: number;
  orderId: number;
  provider: string;
  providerReference: string | null;
  amountXof: number;
  status:
    | 'PENDING'
    | 'PAID'
    | 'HELD'
    | 'RELEASED'
    | 'REFUNDED'
    | 'FAILED'
    | 'DISPUTED'
    | 'COD_PENDING'
    | 'COD_COLLECTED';
  webhookVerified: boolean;
  createdAt: string;
}

export interface ShopReview {
  id: number;
  orderId: number | null;
  shopId: number;
  rating: number;
  priceRespected: boolean;
  comment: string | null;
  isVerifiedPurchase: boolean;
  customerName: string;
  createdAt: string;
}

export interface Order {
  id: number;
  orderNumber: string;
  customerUserId: number;
  shopId: number;
  status: string;
  itemsSubtotalXof: number;
  deliveryFeeXof: number;
  platformCommissionXof: number;
  merchantNetXof: number;
  totalAmountXof: number;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryCommune: string;
  deliveryQuartier: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  isDiasporaOrder: boolean;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  diasporaMessage: string | null;
  displayCurrency: string;
  fxRateApplied: number;
  createdAt: string;
  shop?: MerchantShop;
  market?: Market;
  items?: Array<{
    id: number;
    productName: string;
    quantityOrWeight: number;
    unitLabel: string;
    unitPriceXof: number;
    totalPriceXof: number;
  }>;
  deliveryRequest?: DeliveryRequest | null;
  latestPayment?: Payment | null;
  review?: ShopReview | null;
  tracking?: Array<{
    id: number;
    lat: number;
    lng: number;
    heading?: number | null;
    speedKmh?: number | null;
    source: string;
    recordedAt: string;
  }>;
}

export interface FxRates {
  base: string;
  source?: string;
  rates: Record<string, number>;
  error?: string;
}
