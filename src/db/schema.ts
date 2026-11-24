import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. users
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull(),
    fullName: text('full_name'),
    phone: text('phone'),
    role: text('role').notNull().default('customer'), // customer | merchant | super_admin | admin | support | finance_controller
    preferredLang: text('preferred_lang').notNull().default('fr'), // fr | nouchi
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_users_role').on(table.role)]
);

// 2. customer_profiles
export const customerProfiles = pgTable('customer_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  city: text('city').default('Abidjan'),
  commune: text('commune').default('Cocody'),
  quartier: text('quartier'),
  addressLabel: text('address_label'),
  deliveryNotes: text('delivery_notes'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  isDiaspora: boolean('is_diaspora').default(false).notNull(),
  diasporaCountry: text('diaspora_country'),
  preferredCurrency: text('preferred_currency').default('XOF').notNull(),
  savedAddresses: jsonb('saved_addresses').$type<
    Array<{
      id: string;
      label: string;
      city: string;
      commune: string;
      quartier: string;
      recipientName?: string;
      recipientPhone?: string;
      lat?: number;
      lng?: number;
    }>
  >().default([]),
  favoriteShopIds: jsonb('favorite_shop_ids').$type<number[]>().default([]).notNull(),
  shoppingList: jsonb('shopping_list')
    .$type<
      Array<{
        id: string;
        productName: string;
        defaultQty: number;
        unitLabel: string;
        notes?: string;
      }>
    >()
    .default([])
    .notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. merchant_profiles
export const merchantProfiles = pgTable('merchant_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  identityStatus: text('identity_status').notNull().default('pending'), // pending | verified | rejected
  idDocType: text('id_doc_type'),
  idDocNumber: text('id_doc_number'),
  phone: text('phone').notNull(),
  mobileMoneyProvider: text('mobile_money_provider').default('wave'),
  mobileMoneyNumber: text('mobile_money_number'),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. markets
export const markets = pgTable(
  'markets',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    commune: text('commune').notNull(),
    address: text('address'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_markets_city').on(table.city)]
);

// 5. merchant_shops
export const merchantShops = pgTable(
  'merchant_shops',
  {
    id: serial('id').primaryKey(),
    merchantProfileId: integer('merchant_profile_id')
      .references(() => merchantProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    marketId: integer('market_id')
      .references(() => markets.id)
      .notNull(),
    shopName: text('shop_name').notNull(),
    photoUrl: text('photo_url'),
    stallLocation: text('stall_location'),
    categories: jsonb('categories').$type<string[]>().default([]).notNull(),
    openingHours: text('opening_hours').default('06:30 - 18:30').notNull(),
    isStarMerchant: boolean('is_star_merchant').default(false).notNull(),
    starReason: text('star_reason'),
    ratingAvg: doublePrecision('rating_avg').default(0).notNull(),
    reviewCount: integer('review_count').default(0).notNull(),
    completedOrdersCount: integer('completed_orders_count').default(0).notNull(),
    cancelledOrdersCount: integer('cancelled_orders_count').default(0).notNull(),
    priceRespectRate: doublePrecision('price_respect_rate').default(100).notNull(),
    isOnline: boolean('is_online').default(false).notNull(),
    isApproved: boolean('is_approved').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_shops_market').on(table.marketId),
    index('idx_shops_online').on(table.isOnline),
  ]
);

// 6. product_categories
export const productCategories = pgTable('product_categories', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameNouchi: text('name_nouchi'),
  sortOrder: integer('sort_order').default(0).notNull(),
});

// 7. products
export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .references(() => merchantShops.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: integer('category_id')
      .references(() => productCategories.id)
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    unitLabel: text('unit_label').notNull().default('kg'), // kg | tas | panier | unité | litre
    unitPriceXof: integer('unit_price_xof').notNull(),
    stockQty: integer('stock_qty').default(20).notNull(),
    isAvailable: boolean('is_available').default(true).notNull(),
    photoUrl: text('photo_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_products_shop').on(table.shopId),
    index('idx_products_category').on(table.categoryId),
  ]
);

// 8. live_sessions
export const liveSessions = pgTable(
  'live_sessions',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .references(() => merchantShops.id, { onDelete: 'cascade' })
      .notNull(),
    hostUserId: integer('host_user_id')
      .references(() => users.id)
      .notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('live'), // live | ended
    cameraFacing: text('camera_facing').default('environment').notNull(),
    videoQuality: text('video_quality').default('auto_3g_4g').notNull(),
    viewerCount: integer('viewer_count').default(0).notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [index('idx_live_status').on(table.status)]
);

// 9. live_participants
export const liveParticipants = pgTable('live_participants', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id')
    .references(() => liveSessions.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  role: text('role').notNull().default('viewer'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  leftAt: timestamp('left_at'),
  isConnected: boolean('is_connected').default(true).notNull(),
});

// Helper table for live session chat & camera inspection requests
export const liveMessages = pgTable('live_messages', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id')
    .references(() => liveSessions.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  senderName: text('sender_name').notNull(),
  messageType: text('message_type').notNull().default('chat'), // chat | product_request | system
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 10. carts
export const carts = pgTable('carts', {
  id: serial('id').primaryKey(),
  customerUserId: integer('customer_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  shopId: integer('shop_id')
    .references(() => merchantShops.id)
    .notNull(),
  liveSessionId: integer('live_session_id').references(() => liveSessions.id),
  status: text('status').notNull().default('active'), // active | converted | abandoned
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. cart_items
export const cartItems = pgTable('cart_items', {
  id: serial('id').primaryKey(),
  cartId: integer('cart_id')
    .references(() => carts.id, { onDelete: 'cascade' })
    .notNull(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  productName: text('product_name').notNull(),
  quantityOrWeight: doublePrecision('quantity_or_weight').notNull(),
  unitLabel: text('unit_label').notNull(),
  originalUnitPriceXof: integer('original_unit_price_xof').notNull(),
  proposedUnitPriceXof: integer('proposed_unit_price_xof'),
  unitPriceXof: integer('unit_price_xof').notNull(),
  totalPriceXof: integer('total_price_xof').notNull(),
  priceProposalStatus: text('price_proposal_status').notNull().default('confirmed'), // confirmed | pending_customer_approval | rejected
  customerConfirmed: boolean('customer_confirmed').default(true).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 12. orders
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    customerUserId: integer('customer_user_id')
      .references(() => users.id)
      .notNull(),
    shopId: integer('shop_id')
      .references(() => merchantShops.id)
      .notNull(),
    liveSessionId: integer('live_session_id').references(() => liveSessions.id),
    status: text('status').notNull().default('pending_merchant'),
    itemsSubtotalXof: integer('items_subtotal_xof').notNull(),
    deliveryFeeXof: integer('delivery_fee_xof').default(0).notNull(),
    platformCommissionXof: integer('platform_commission_xof').notNull(),
    merchantNetXof: integer('merchant_net_xof').notNull(),
    totalAmountXof: integer('total_amount_xof').notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryCity: text('delivery_city').notNull(),
    deliveryCommune: text('delivery_commune').notNull(),
    deliveryQuartier: text('delivery_quartier'),
    deliveryLat: doublePrecision('delivery_lat'),
    deliveryLng: doublePrecision('delivery_lng'),
    isDiasporaOrder: boolean('is_diaspora_order').default(false).notNull(),
    beneficiaryName: text('beneficiary_name'),
    beneficiaryPhone: text('beneficiary_phone'),
    diasporaMessage: text('diaspora_message'),
    displayCurrency: text('display_currency').default('XOF').notNull(),
    fxRateApplied: doublePrecision('fx_rate_applied').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_orders_customer').on(table.customerUserId),
    index('idx_orders_shop').on(table.shopId),
    index('idx_orders_status').on(table.status),
  ]
);

// 13. order_items
export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  productName: text('product_name').notNull(),
  quantityOrWeight: doublePrecision('quantity_or_weight').notNull(),
  unitLabel: text('unit_label').notNull(),
  unitPriceXof: integer('unit_price_xof').notNull(),
  totalPriceXof: integer('total_price_xof').notNull(),
  merchantConfirmed: boolean('merchant_confirmed').default(false).notNull(),
  customerApproved: boolean('customer_approved').default(true).notNull(),
});

// 14. delivery_requests
export const deliveryRequests = pgTable('delivery_requests', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  provider: text('provider').notNull(), // yango_delivery | manual_courier
  externalClaimId: text('external_claim_id'),
  status: text('status').notNull().default('pending_quote'),
  quotedPriceXof: integer('quoted_price_xof'),
  currency: text('currency').default('XOF').notNull(),
  pickupAddress: text('pickup_address').notNull(),
  pickupLat: doublePrecision('pickup_lat'),
  pickupLng: doublePrecision('pickup_lng'),
  dropoffAddress: text('dropoff_address').notNull(),
  dropoffLat: doublePrecision('dropoff_lat'),
  dropoffLng: doublePrecision('dropoff_lng'),
  courierName: text('courier_name'),
  courierPhone: text('courier_phone'),
  customerDecision: text('customer_decision').default('pending').notNull(), // pending | accepted | rejected
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 15. delivery_tracking
export const deliveryTracking = pgTable('delivery_tracking', {
  id: serial('id').primaryKey(),
  deliveryRequestId: integer('delivery_request_id')
    .references(() => deliveryRequests.id, { onDelete: 'cascade' })
    .notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  heading: doublePrecision('heading'),
  speedKmh: doublePrecision('speed_kmh'),
  source: text('source').notNull(), // yango_webhook | courier_device_gps
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

// 16. payments
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .references(() => orders.id)
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),
    provider: text('provider').notNull(), // wave | orange_money | mtn_momo | moov_money | card
    providerReference: text('provider_reference').unique(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    amountXof: integer('amount_xof').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | PAID | HELD | RELEASED | REFUNDED | FAILED | DISPUTED
    escrowProvider: text('escrow_provider'),
    webhookVerified: boolean('webhook_verified').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_payments_order').on(table.orderId)]
);

// 17. payment_events
export const paymentEvents = pgTable('payment_events', {
  id: serial('id').primaryKey(),
  paymentId: integer('payment_id')
    .references(() => payments.id, { onDelete: 'cascade' })
    .notNull(),
  eventType: text('event_type').notNull(),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  signatureVerified: boolean('signature_verified').default(false).notNull(),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 18. commissions
export const commissions = pgTable('commissions', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id)
    .notNull()
    .unique(),
  shopId: integer('shop_id')
    .references(() => merchantShops.id)
    .notNull(),
  goodsAmountXof: integer('goods_amount_xof').notNull(),
  ratePercent: doublePrecision('rate_percent').default(10).notNull(),
  commissionAmountXof: integer('commission_amount_xof').notNull(),
  status: text('status').default('accrued').notNull(), // accrued | settled | refunded
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 19. merchant_balances
export const merchantBalances = pgTable('merchant_balances', {
  id: serial('id').primaryKey(),
  shopId: integer('shop_id')
    .references(() => merchantShops.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  availableBalanceXof: integer('available_balance_xof').default(0).notNull(),
  pendingEscrowXof: integer('pending_escrow_xof').default(0).notNull(),
  totalPaidOutXof: integer('total_paid_out_xof').default(0).notNull(),
  totalCommissionsXof: integer('total_commissions_xof').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 20. payouts
export const payouts = pgTable('payouts', {
  id: serial('id').primaryKey(),
  shopId: integer('shop_id')
    .references(() => merchantShops.id)
    .notNull(),
  amountXof: integer('amount_xof').notNull(),
  provider: text('provider').notNull(),
  destinationPhone: text('destination_phone').notNull(),
  status: text('status').default('requested').notNull(), // requested | processing | paid | failed
  reference: text('reference'),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
});

// 21. reviews
export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id)
    .unique(),
  shopId: integer('shop_id')
    .references(() => merchantShops.id)
    .notNull(),
  customerUserId: integer('customer_user_id')
    .references(() => users.id)
    .notNull(),
  rating: integer('rating').notNull(),
  priceRespected: boolean('price_respected').default(true).notNull(),
  comment: text('comment'),
  isVerifiedPurchase: boolean('is_verified_purchase').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 22. notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category').notNull(), // order | delivery | payment | live | system
    relatedOrderId: integer('related_order_id'),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_notifications_user').on(table.userId)]
);

// 23. disputes
export const disputes = pgTable('disputes', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id)
    .notNull(),
  openedByUserId: integer('opened_by_user_id')
    .references(() => users.id)
    .notNull(),
  reason: text('reason').notNull(),
  description: text('description').notNull(),
  status: text('status').default('open').notNull(), // open | investigating | resolved_refund | resolved_release | closed
  resolutionNotes: text('resolution_notes'),
  resolvedByUserId: integer('resolved_by_user_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 24. audit_logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_audit_created').on(table.createdAt)]
);

// 25. push_subscriptions
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_push_sub_user').on(table.userId)]
);

// 26. push_vapid_config
export const pushVapidConfig = pgTable('push_vapid_config', {
  id: serial('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [users.id],
    references: [customerProfiles.userId],
  }),
  merchantProfile: one(merchantProfiles, {
    fields: [users.id],
    references: [merchantProfiles.userId],
  }),
  orders: many(orders),
  notifications: many(notifications),
}));

export const marketsRelations = relations(markets, ({ many }) => ({
  shops: many(merchantShops),
}));

export const merchantShopsRelations = relations(merchantShops, ({ one, many }) => ({
  merchantProfile: one(merchantProfiles, {
    fields: [merchantShops.merchantProfileId],
    references: [merchantProfiles.id],
  }),
  market: one(markets, {
    fields: [merchantShops.marketId],
    references: [markets.id],
  }),
  products: many(products),
  liveSessions: many(liveSessions),
  balance: one(merchantBalances, {
    fields: [merchantShops.id],
    references: [merchantBalances.shopId],
  }),
}));

export const productsRelations = relations(products, ({ one }) => ({
  shop: one(merchantShops, {
    fields: [products.shopId],
    references: [merchantShops.id],
  }),
  category: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(users, {
    fields: [orders.customerUserId],
    references: [users.id],
  }),
  shop: one(merchantShops, {
    fields: [orders.shopId],
    references: [merchantShops.id],
  }),
  items: many(orderItems),
  deliveryRequest: one(deliveryRequests, {
    fields: [orders.id],
    references: [deliveryRequests.orderId],
  }),
  payments: many(payments),
  commission: one(commissions, {
    fields: [orders.id],
    references: [commissions.orderId],
  }),
}));
