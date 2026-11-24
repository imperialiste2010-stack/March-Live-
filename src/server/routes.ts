import crypto from 'crypto';
import { Express, Request, Response } from 'express';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  cartItems,
  carts,
  commissions,
  customerProfiles,
  deliveryRequests,
  deliveryTracking,
  disputes,
  liveMessages,
  liveSessions,
  markets,
  merchantBalances,
  merchantProfiles,
  merchantShops,
  notifications,
  orderItems,
  orders,
  paymentEvents,
  payments,
  payouts,
  productCategories,
  products,
  pushSubscriptions,
  reviews,
  users,
} from '../db/schema.ts';
import { AuthRequest, optionalAuth, requireAuth, requireRoles } from '../middleware/auth.ts';
import { getVapidPublicKey, sendPushToUser } from './push.ts';
import { recalculateStarBadge } from './starBadge.ts';
import { broadcastToSession, broadcastToShop, broadcastToUser } from './ws.ts';

// FX rates cache (1 hour)
let fxCache: {
  timestamp: number;
  base: string;
  source: string;
  rates: Record<string, number>;
} | null = null;

async function createAuditLog(params: {
  actorUserId?: number;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      details: params.details ?? {},
      ipAddress: params.ipAddress ?? null,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

async function createNotification(params: {
  userId: number;
  title: string;
  body: string;
  category: string;
  relatedOrderId?: number;
  liveSessionId?: number;
  url?: string;
}) {
  try {
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: params.userId,
        title: params.title,
        body: params.body,
        category: params.category,
        relatedOrderId: params.relatedOrderId ?? null,
      })
      .returning();
    broadcastToUser(params.userId, 'notification:new', {
      ...notif,
      liveSessionId: params.liveSessionId ?? null,
      url: params.url ?? null,
    });
    sendPushToUser(params.userId, {
      title: params.title,
      body: params.body,
      category: params.category,
      orderId: params.relatedOrderId,
      liveSessionId: params.liveSessionId,
      url: params.url || '/',
    }).catch((err) => console.error('Failed to send push notification:', err));
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

export function registerApiRoutes(app: Express) {
  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'marche-live-api', timestamp: new Date().toISOString() });
  });

  // Live FX rates for Diaspora (XOF -> EUR, USD, CAD, GBP)
  app.get('/api/fx-rates', async (_req, res) => {
    try {
      const now = Date.now();
      if (fxCache && now - fxCache.timestamp < 3600 * 1000) {
        return res.json(fxCache);
      }

      const response = await fetch('https://open.er-api.com/v6/latest/XOF');
      if (!response.ok) {
        throw new Error(`FX API HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        result?: string;
        time_last_update_utc?: string;
        rates?: Record<string, number>;
      };

      if (!data.rates) {
        throw new Error('Missing rates payload');
      }

      fxCache = {
        timestamp: now,
        base: 'XOF',
        source: `ExchangeRate-API (${data.time_last_update_utc || 'UTC'})`,
        rates: {
          XOF: 1,
          EUR: data.rates.EUR,
          USD: data.rates.USD,
          CAD: data.rates.CAD,
          GBP: data.rates.GBP,
        },
      };

      res.json(fxCache);
    } catch (error) {
      console.error('FX rate fetch error:', error);
      // Do not invent fake FX rates; return explicit unavailable state with XOF=1
      res.status(503).json({
        error: 'Source de taux de change momentanément indisponible. Montants affichés en FCFA (XOF).',
        base: 'XOF',
        rates: { XOF: 1 },
      });
    }
  });

  // Public markets & categories
  app.get('/api/markets', async (req, res) => {
    try {
      const city = req.query.city ? String(req.query.city) : undefined;
      const rows = await db
        .select()
        .from(markets)
        .where(
          city
            ? and(eq(markets.isActive, true), ilike(markets.city, city))
            : eq(markets.isActive, true)
        )
        .orderBy(markets.city, markets.name);
      res.json(rows);
    } catch (error) {
      console.error('GET /api/markets failed:', error);
      res.status(500).json({ error: 'Impossible de charger les marchés.' });
    }
  });

  app.get('/api/categories', async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(productCategories)
        .orderBy(productCategories.sortOrder);
      res.json(rows);
    } catch (error) {
      console.error('GET /api/categories failed:', error);
      res.status(500).json({ error: 'Impossible de charger les catégories.' });
    }
  });

  // Public shops directory with search & filters
  app.get('/api/shops', async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q).trim() : '';
      const city = req.query.city ? String(req.query.city).trim() : '';
      const commune = req.query.commune ? String(req.query.commune).trim() : '';
      const marketId = req.query.marketId ? Number(req.query.marketId) : undefined;
      const category = req.query.category ? String(req.query.category).trim() : '';
      const liveOnly = req.query.liveOnly === 'true';
      const sort = req.query.sort ? String(req.query.sort).trim() : 'relevance';

      const rawMinPrice =
        req.query.minPrice !== undefined && req.query.minPrice !== ''
          ? Number(req.query.minPrice)
          : undefined;
      const rawMaxPrice =
        req.query.maxPrice !== undefined && req.query.maxPrice !== ''
          ? Number(req.query.maxPrice)
          : undefined;
      let minPrice =
        rawMinPrice !== undefined && Number.isFinite(rawMinPrice) && rawMinPrice >= 0
          ? rawMinPrice
          : undefined;
      let maxPrice =
        rawMaxPrice !== undefined && Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0
          ? rawMaxPrice
          : undefined;
      if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
        [minPrice, maxPrice] = [maxPrice, minPrice];
      }
      const hasPriceFilter = minPrice !== undefined || maxPrice !== undefined;

      const shopRows = await db
        .select({
          shop: merchantShops,
          market: markets,
        })
        .from(merchantShops)
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(merchantShops.isApproved, true))
        .orderBy(desc(merchantShops.isOnline), desc(merchantShops.isStarMerchant), desc(merchantShops.ratingAvg));

      const activeLives = await db
        .select()
        .from(liveSessions)
        .where(eq(liveSessions.status, 'live'));

      const liveByShop = new Map(activeLives.map((l) => [l.shopId, l]));

      const allProducts = await db
        .select({
          product: products,
          categorySlug: productCategories.slug,
        })
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(eq(products.isAvailable, true));

      const enriched = shopRows
        .map(({ shop, market }) => {
          const shopProducts = allProducts
            .filter((p) => p.product.shopId === shop.id)
            .map((p) => ({ ...p.product, categorySlug: p.categorySlug }));
          const activeLive = liveByShop.get(shop.id) || null;
          return {
            ...shop,
            market,
            activeLive,
            products: shopProducts,
          };
        })
        .filter((s) => {
          if (city && s.market.city.toLowerCase() !== city.toLowerCase()) return false;
          if (commune && s.market.commune.toLowerCase() !== commune.toLowerCase()) return false;
          if (marketId && s.marketId !== marketId) return false;
          if (liveOnly && !s.activeLive) return false;

          const budgetProducts = hasPriceFilter
            ? s.products.filter(
                (p) =>
                  (minPrice === undefined || p.unitPriceXof >= minPrice) &&
                  (maxPrice === undefined || p.unitPriceXof <= maxPrice)
              )
            : s.products;

          if (hasPriceFilter && budgetProducts.length === 0) return false;

          if (category) {
            const hasCat = hasPriceFilter
              ? budgetProducts.some((p) => p.categorySlug === category)
              : s.categories.includes(category) ||
                s.products.some((p) => p.categorySlug === category);
            if (!hasCat) return false;
          }
          if (q) {
            const lq = q.toLowerCase();
            const matchesShop = s.shopName.toLowerCase().includes(lq);
            const matchesMarket = s.market.name.toLowerCase().includes(lq) || s.market.city.toLowerCase().includes(lq);
            const matchesProduct = budgetProducts.some((p) => p.name.toLowerCase().includes(lq));
            if (!matchesShop && !matchesMarket && !matchesProduct) return false;
          }
          return true;
        });

      const getSortReferenceProducts = (s: (typeof enriched)[number]) => {
        const filtered = s.products.filter(
          (p) =>
            (!hasPriceFilter ||
              ((minPrice === undefined || p.unitPriceXof >= minPrice) &&
                (maxPrice === undefined || p.unitPriceXof <= maxPrice))) &&
            (!category || p.categorySlug === category)
        );
        if (q) {
          const lq = q.toLowerCase();
          const queryMatched = filtered.filter((p) => p.name.toLowerCase().includes(lq));
          if (queryMatched.length > 0) return queryMatched;
        }
        return filtered.length > 0 ? filtered : s.products;
      };

      if (sort === 'price_asc') {
        enriched.sort((a, b) => {
          const prodsA = getSortReferenceProducts(a);
          const prodsB = getSortReferenceProducts(b);
          const minA = prodsA.length > 0 ? Math.min(...prodsA.map((p) => p.unitPriceXof)) : Number.POSITIVE_INFINITY;
          const minB = prodsB.length > 0 ? Math.min(...prodsB.map((p) => p.unitPriceXof)) : Number.POSITIVE_INFINITY;
          if (minA !== minB) return minA - minB;
          return b.ratingAvg - a.ratingAvg;
        });
      } else if (sort === 'price_desc') {
        enriched.sort((a, b) => {
          const prodsA = getSortReferenceProducts(a);
          const prodsB = getSortReferenceProducts(b);
          const maxA = prodsA.length > 0 ? Math.max(...prodsA.map((p) => p.unitPriceXof)) : -1;
          const maxB = prodsB.length > 0 ? Math.max(...prodsB.map((p) => p.unitPriceXof)) : -1;
          if (maxA !== maxB) return maxB - maxA;
          return b.ratingAvg - a.ratingAvg;
        });
      } else if (sort === 'rating_desc') {
        enriched.sort((a, b) => {
          if (b.ratingAvg !== a.ratingAvg) return b.ratingAvg - a.ratingAvg;
          if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
          return b.completedOrdersCount - a.completedOrdersCount;
        });
      }

      res.json(enriched);
    } catch (error) {
      console.error('GET /api/shops failed:', error);
      res.status(500).json({ error: 'Impossible de charger les commerçants.' });
    }
  });

  app.get('/api/shops/:id', async (req, res) => {
    try {
      const shopId = Number(req.params.id);
      const rows = await db
        .select({ shop: merchantShops, market: markets })
        .from(merchantShops)
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(merchantShops.id, shopId))
        .limit(1);

      if (!rows[0]) {
        return res.status(404).json({ error: 'Boutique introuvable.' });
      }

      const shopProducts = await db
        .select({
          product: products,
          category: productCategories,
        })
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(eq(products.shopId, shopId));

      const [activeLive] = await db
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.status, 'live')))
        .limit(1);

      const shopReviews = await db
        .select({
          review: reviews,
          customerName: users.fullName,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.customerUserId, users.id))
        .where(eq(reviews.shopId, shopId))
        .orderBy(desc(reviews.createdAt))
        .limit(20);

      res.json({
        ...rows[0].shop,
        market: rows[0].market,
        activeLive: activeLive || null,
        products: shopProducts.map((p) => ({ ...p.product, category: p.category })),
        reviews: shopReviews.map((r) => ({ ...r.review, customerName: r.customerName || 'Client vérifié' })),
      });
    } catch (error) {
      console.error('GET /api/shops/:id failed:', error);
      res.status(500).json({ error: 'Impossible de charger cette boutique.' });
    }
  });

  // Public & authenticated Shop Reviews endpoint (links delivered order when available)
  app.post('/api/shops/:id/reviews', requireAuth, async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.id);
      if (!Number.isInteger(shopId) || shopId <= 0) {
        return res.status(400).json({ error: 'Identifiant boutique invalide.' });
      }
      const { rating, priceRespected, comment } = req.body;
      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: 'Une note entre 1 et 5 étoiles est requise.' });
      }

      const [shop] = await db
        .select()
        .from(merchantShops)
        .where(eq(merchantShops.id, shopId))
        .limit(1);
      if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });

      const userId = req.dbUser!.id;
      const trimmedComment = comment ? String(comment).trim().slice(0, 600) : null;

      // Check if customer has a delivered order at this shop not yet reviewed
      const deliveredOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.shopId, shopId),
            eq(orders.customerUserId, userId),
            eq(orders.status, 'delivered')
          )
        )
        .orderBy(desc(orders.createdAt));

      let unreviewedOrderId: number | null = null;
      if (deliveredOrders.length > 0) {
        const existingOrderReviews = await db
          .select({ orderId: reviews.orderId })
          .from(reviews)
          .where(inArray(reviews.orderId, deliveredOrders.map((o) => o.id)));
        const reviewedIds = new Set(existingOrderReviews.map((x) => x.orderId));
        const candidate = deliveredOrders.find((o) => !reviewedIds.has(o.id));
        if (candidate) unreviewedOrderId = candidate.id;
      }

      let savedReview;
      if (unreviewedOrderId) {
        const [inserted] = await db
          .insert(reviews)
          .values({
            orderId: unreviewedOrderId,
            shopId,
            customerUserId: userId,
            rating: r,
            priceRespected: priceRespected !== false,
            comment: trimmedComment,
            isVerifiedPurchase: true,
          })
          .returning();
        savedReview = inserted;
      } else {
        // Check if user already left a direct (non-order) review for this shop; update it if so
        const [existingDirect] = await db
          .select()
          .from(reviews)
          .where(
            and(
              eq(reviews.shopId, shopId),
              eq(reviews.customerUserId, userId),
              isNull(reviews.orderId)
            )
          )
          .limit(1);

        if (existingDirect) {
          const [updated] = await db
            .update(reviews)
            .set({
              rating: r,
              priceRespected: priceRespected !== false,
              comment: trimmedComment,
            })
            .where(eq(reviews.id, existingDirect.id))
            .returning();
          savedReview = updated;
        } else {
          const [inserted] = await db
            .insert(reviews)
            .values({
              orderId: null,
              shopId,
              customerUserId: userId,
              rating: r,
              priceRespected: priceRespected !== false,
              comment: trimmedComment,
              isVerifiedPurchase: false,
            })
            .returning();
          savedReview = inserted;
        }
      }

      const badgeStats = await recalculateStarBadge(shopId);
      res.status(201).json({
        review: {
          ...savedReview,
          customerName: req.dbUser!.fullName || 'Client MARCHÉ LIVE',
        },
        stats: badgeStats,
      });
    } catch (error) {
      console.error('POST /api/shops/:id/reviews failed:', error);
      res.status(500).json({ error: 'Impossible d’enregistrer votre avis.' });
    }
  });

  // Public active LIVE sessions
  app.get('/api/lives', async (_req, res) => {
    try {
      const rows = await db
        .select({
          session: liveSessions,
          shop: merchantShops,
          market: markets,
        })
        .from(liveSessions)
        .innerJoin(merchantShops, eq(liveSessions.shopId, merchantShops.id))
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(liveSessions.status, 'live'))
        .orderBy(desc(liveSessions.startedAt));

      res.json(
        rows.map((r) => ({
          ...r.session,
          shop: r.shop,
          market: r.market,
        }))
      );
    } catch (error) {
      console.error('GET /api/lives failed:', error);
      res.status(500).json({ error: 'Impossible de charger les sessions LIVE.' });
    }
  });

  app.get('/api/lives/:id', async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const rows = await db
        .select({
          session: liveSessions,
          shop: merchantShops,
          market: markets,
        })
        .from(liveSessions)
        .innerJoin(merchantShops, eq(liveSessions.shopId, merchantShops.id))
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(liveSessions.id, sessionId))
        .limit(1);

      if (!rows[0]) {
        return res.status(404).json({ error: 'Session LIVE introuvable.' });
      }

      const shopProducts = await db
        .select({
          product: products,
          category: productCategories,
        })
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(eq(products.shopId, rows[0].shop.id));

      const messages = await db
        .select()
        .from(liveMessages)
        .where(eq(liveMessages.sessionId, sessionId))
        .orderBy(liveMessages.createdAt)
        .limit(80);

      res.json({
        ...rows[0].session,
        shop: rows[0].shop,
        market: rows[0].market,
        products: shopProducts.map((p) => ({ ...p.product, category: p.category })),
        messages,
      });
    } catch (error) {
      console.error('GET /api/lives/:id failed:', error);
      res.status(500).json({ error: 'Impossible de charger la session LIVE.' });
    }
  });

  // Authenticated User & Profile
  app.get('/api/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const [customerProfile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, dbUser.id))
        .limit(1);

      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, dbUser.id))
        .limit(1);

      let shops: any[] = [];
      if (merchantProfile) {
        shops = await db
          .select({
            shop: merchantShops,
            market: markets,
          })
          .from(merchantShops)
          .innerJoin(markets, eq(merchantShops.marketId, markets.id))
          .where(eq(merchantShops.merchantProfileId, merchantProfile.id));
      }

      const unreadNotifs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, dbUser.id), eq(notifications.isRead, false)));

      res.json({
        user: dbUser,
        customerProfile: customerProfile || null,
        merchantProfile: merchantProfile || null,
        shops: shops.map((s) => ({ ...s.shop, market: s.market })),
        unreadNotificationsCount: unreadNotifs.length,
      });
    } catch (error) {
      console.error('GET /api/me failed:', error);
      res.status(500).json({ error: 'Impossible de charger votre profil.' });
    }
  });

  app.put('/api/me/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const {
        fullName,
        phone,
        preferredLang,
        city,
        commune,
        quartier,
        addressLabel,
        deliveryNotes,
        lat,
        lng,
        isDiaspora,
        diasporaCountry,
        preferredCurrency,
        savedAddresses,
      } = req.body;

      await db
        .update(users)
        .set({
          fullName: fullName !== undefined ? String(fullName).trim() : dbUser.fullName,
          phone: phone !== undefined ? String(phone).trim() : dbUser.phone,
          preferredLang:
            preferredLang === 'nouchi' || preferredLang === 'fr'
              ? preferredLang
              : dbUser.preferredLang,
          updatedAt: new Date(),
        })
        .where(eq(users.id, dbUser.id));

      const [updatedProfile] = await db
        .insert(customerProfiles)
        .values({
          userId: dbUser.id,
          city: city || 'Abidjan',
          commune: commune || 'Cocody',
          quartier: quartier || null,
          addressLabel: addressLabel || null,
          deliveryNotes: deliveryNotes || null,
          lat: typeof lat === 'number' ? lat : null,
          lng: typeof lng === 'number' ? lng : null,
          isDiaspora: Boolean(isDiaspora),
          diasporaCountry: diasporaCountry || null,
          preferredCurrency: preferredCurrency || 'XOF',
          savedAddresses: Array.isArray(savedAddresses) ? savedAddresses : [],
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: customerProfiles.userId,
          set: {
            city: city || 'Abidjan',
            commune: commune || 'Cocody',
            quartier: quartier ?? null,
            addressLabel: addressLabel ?? null,
            deliveryNotes: deliveryNotes ?? null,
            lat: typeof lat === 'number' ? lat : null,
            lng: typeof lng === 'number' ? lng : null,
            isDiaspora: Boolean(isDiaspora),
            diasporaCountry: diasporaCountry ?? null,
            preferredCurrency: preferredCurrency || 'XOF',
            ...(Array.isArray(savedAddresses) ? { savedAddresses } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json({ ok: true, customerProfile: updatedProfile });
    } catch (error) {
      console.error('PUT /api/me/profile failed:', error);
      res.status(500).json({ error: 'Erreur lors de la mise à jour du profil.' });
    }
  });

  app.get('/api/me/favorites', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, dbUser.id))
        .limit(1);

      const favoriteShopIds = Array.isArray(profile?.favoriteShopIds)
        ? profile.favoriteShopIds.filter((id) => Number.isInteger(id) && id > 0)
        : [];

      if (favoriteShopIds.length === 0) {
        return res.json({ favoriteShopIds: [], favoriteShops: [] });
      }

      const shopRows = await db
        .select({ shop: merchantShops, market: markets })
        .from(merchantShops)
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(inArray(merchantShops.id, favoriteShopIds));

      const activeLives = await db
        .select()
        .from(liveSessions)
        .where(eq(liveSessions.status, 'live'));
      const liveByShop = new Map(activeLives.map((l) => [l.shopId, l]));

      const shopById = new Map(
        shopRows.map(({ shop, market }) => [
          shop.id,
          { ...shop, market, activeLive: liveByShop.get(shop.id) || null },
        ])
      );
      const favoriteShops = favoriteShopIds
        .map((id) => shopById.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));

      res.json({ favoriteShopIds, favoriteShops });
    } catch (error) {
      console.error('GET /api/me/favorites failed:', error);
      res.status(500).json({ error: 'Impossible de charger vos commerçants favoris.' });
    }
  });

  app.post('/api/me/favorites/:shopId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const shopId = Number(req.params.shopId);
      if (!Number.isInteger(shopId) || shopId <= 0) {
        return res.status(400).json({ error: 'Identifiant de boutique invalide.' });
      }

      const [shopExists] = await db
        .select({ id: merchantShops.id })
        .from(merchantShops)
        .where(eq(merchantShops.id, shopId))
        .limit(1);

      if (!shopExists) {
        return res.status(404).json({ error: 'Boutique introuvable.' });
      }

      const [existingProfile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, dbUser.id))
        .limit(1);

      const currentIds = Array.isArray(existingProfile?.favoriteShopIds)
        ? existingProfile.favoriteShopIds.filter((id) => Number.isInteger(id) && id > 0)
        : [];

      const alreadyFavorite = currentIds.includes(shopId);
      const nextIds = alreadyFavorite
        ? currentIds.filter((id) => id !== shopId)
        : [shopId, ...currentIds];

      await db
        .insert(customerProfiles)
        .values({
          userId: dbUser.id,
          favoriteShopIds: nextIds,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: customerProfiles.userId,
          set: {
            favoriteShopIds: nextIds,
            updatedAt: new Date(),
          },
        });

      res.json({
        ok: true,
        isFavorite: !alreadyFavorite,
        favoriteShopIds: nextIds,
      });
    } catch (error) {
      console.error('POST /api/me/favorites/:shopId failed:', error);
      res.status(500).json({ error: 'Impossible de mettre à jour vos favoris.' });
    }
  });

  // Recurring Shopping List ("Liste de courses")
  app.get('/api/me/shopping-list', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, req.dbUser!.id))
        .limit(1);
      const items = Array.isArray(profile?.shoppingList) ? profile.shoppingList : [];
      res.json({ items });
    } catch (error) {
      console.error('GET /api/me/shopping-list failed:', error);
      res.status(500).json({ error: 'Impossible de charger la liste de courses.' });
    }
  });

  app.post('/api/me/shopping-list', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const rawName = String(req.body?.productName || '').trim();
      const rawQty = Number(req.body?.defaultQty ?? 1);
      const rawUnit = String(req.body?.unitLabel || 'kg').trim().slice(0, 24) || 'kg';
      const rawNotes = req.body?.notes ? String(req.body.notes).trim().slice(0, 160) : undefined;

      if (!rawName || rawName.length < 2) {
        return res.status(400).json({ error: 'Nom du produit requis (min. 2 caractères).' });
      }
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        return res.status(400).json({ error: 'Quantité par défaut invalide.' });
      }

      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, dbUser.id))
        .limit(1);

      const currentList = Array.isArray(profile?.shoppingList) ? profile.shoppingList : [];
      const newItem = {
        id: crypto.randomUUID(),
        productName: rawName.slice(0, 100),
        defaultQty: Math.round(rawQty * 10) / 10,
        unitLabel: rawUnit,
        ...(rawNotes ? { notes: rawNotes } : {}),
      };

      const nextList = [newItem, ...currentList].slice(0, 50);

      await db
        .insert(customerProfiles)
        .values({
          userId: dbUser.id,
          shoppingList: nextList,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: customerProfiles.userId,
          set: {
            shoppingList: nextList,
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true, item: newItem, items: nextList });
    } catch (error) {
      console.error('POST /api/me/shopping-list failed:', error);
      res.status(500).json({ error: 'Impossible d’ajouter ce produit à la liste de courses.' });
    }
  });

  app.delete('/api/me/shopping-list/:itemId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const itemId = String(req.params.itemId || '').trim();
      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, dbUser.id))
        .limit(1);

      const currentList = Array.isArray(profile?.shoppingList) ? profile.shoppingList : [];
      const nextList = currentList.filter((it) => it.id !== itemId);

      await db
        .insert(customerProfiles)
        .values({
          userId: dbUser.id,
          shoppingList: nextList,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: customerProfiles.userId,
          set: {
            shoppingList: nextList,
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true, items: nextList });
    } catch (error) {
      console.error('DELETE /api/me/shopping-list/:itemId failed:', error);
      res.status(500).json({ error: 'Impossible de retirer ce produit de la liste de courses.' });
    }
  });

  // Web Push Notifications
  app.get('/api/push/vapid-public-key', async (_req, res) => {
    try {
      const publicKey = await getVapidPublicKey();
      res.json({ publicKey });
    } catch (error) {
      console.error('GET /api/push/vapid-public-key failed:', error);
      res.status(500).json({ error: 'Clé VAPID indisponible.' });
    }
  });

  app.get('/api/push/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, req.dbUser!.id));
      res.json({ subscribedCount: rows.length });
    } catch (error) {
      console.error('GET /api/push/status failed:', error);
      res.status(500).json({ error: 'Impossible de vérifier le statut push.' });
    }
  });

  app.post('/api/push/subscribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      const sub = req.body?.subscription;
      const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint.trim() : '';
      const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh.trim() : '';
      const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth.trim() : '';

      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: 'Abonnement push invalide.' });
      }

      await db
        .insert(pushSubscriptions)
        .values({
          userId: req.dbUser!.id,
          endpoint,
          p256dh,
          auth,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 250) || null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: req.dbUser!.id,
            p256dh,
            auth,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 250) || null,
          },
        });

      res.json({ ok: true });
    } catch (error) {
      console.error('POST /api/push/subscribe failed:', error);
      res.status(500).json({ error: 'Impossible d’enregistrer l’abonnement push.' });
    }
  });

  app.post('/api/push/unsubscribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
      if (endpoint) {
        await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, req.dbUser!.id),
              eq(pushSubscriptions.endpoint, endpoint)
            )
          );
      } else {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, req.dbUser!.id));
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('POST /api/push/unsubscribe failed:', error);
      res.status(500).json({ error: 'Impossible de supprimer l’abonnement push.' });
    }
  });

  app.post('/api/push/test', requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.dbUser!.id;
      const title = 'MARCHÉ LIVE · Notifications actives';
      const body =
        'Vous recevrez désormais les alertes quand vos commerçants favoris passent en LIVE et le suivi de vos commandes.';

      const [notif] = await db
        .insert(notifications)
        .values({
          userId,
          title,
          body,
          category: 'push_test',
          relatedOrderId: null,
        })
        .returning();

      broadcastToUser(userId, 'notification:new', notif);

      const pushResult = await sendPushToUser(userId, {
        title,
        body,
        category: 'push_test',
        url: '/',
      });

      res.json({ ok: true, ...pushResult });
    } catch (error) {
      console.error('POST /api/push/test failed:', error);
      res.status(500).json({ error: 'Impossible d’envoyer la notification test.' });
    }
  });

  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, req.dbUser!.id))
        .orderBy(desc(notifications.createdAt))
        .limit(40);
      res.json(rows);
    } catch (error) {
      console.error('GET /api/notifications failed:', error);
      res.status(500).json({ error: 'Impossible de charger les notifications.' });
    }
  });

  app.post('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, Number(req.params.id)),
            eq(notifications.userId, req.dbUser!.id)
          )
        );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de marquer la notification.' });
    }
  });

  // Merchant registration & Shop Management
  app.post('/api/merchant/register', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const { phone, idDocType, idDocNumber, mobileMoneyProvider, mobileMoneyNumber } = req.body;

      if (!phone || !idDocType || !idDocNumber) {
        return res.status(400).json({
          error: 'Téléphone et pièce d’identité (CNI / Passeport / Carte consulaire) requis.',
        });
      }

      const [profile] = await db
        .insert(merchantProfiles)
        .values({
          userId: dbUser.id,
          phone: String(phone).trim(),
          idDocType: String(idDocType).trim(),
          idDocNumber: String(idDocNumber).trim(),
          mobileMoneyProvider: mobileMoneyProvider || 'wave',
          mobileMoneyNumber: mobileMoneyNumber || String(phone).trim(),
          identityStatus: 'verified', // Instant KYC validation for MVP; admin can suspend
          verifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: merchantProfiles.userId,
          set: {
            phone: String(phone).trim(),
            idDocType: String(idDocType).trim(),
            idDocNumber: String(idDocNumber).trim(),
            mobileMoneyProvider: mobileMoneyProvider || 'wave',
            mobileMoneyNumber: mobileMoneyNumber || String(phone).trim(),
          },
        })
        .returning();

      if (dbUser.role === 'customer') {
        await db
          .update(users)
          .set({ role: 'merchant', phone: String(phone).trim(), updatedAt: new Date() })
          .where(eq(users.id, dbUser.id));
      }

      await createAuditLog({
        actorUserId: dbUser.id,
        actorRole: dbUser.role,
        action: 'merchant.register',
        entityType: 'merchant_profiles',
        entityId: String(profile.id),
      });

      res.json(profile);
    } catch (error) {
      console.error('POST /api/merchant/register failed:', error);
      res.status(500).json({ error: 'Erreur lors de l’inscription commerçant.' });
    }
  });

  app.post('/api/merchant/shops', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, dbUser.id))
        .limit(1);

      if (!merchantProfile) {
        return res.status(400).json({ error: 'Complétez d’abord votre profil commerçant.' });
      }

      const { shopName, marketId, stallLocation, categories, openingHours, photoUrl } = req.body;
      if (!shopName || !marketId) {
        return res.status(400).json({ error: 'Nom de boutique et marché obligatoires.' });
      }

      const [shop] = await db
        .insert(merchantShops)
        .values({
          merchantProfileId: merchantProfile.id,
          marketId: Number(marketId),
          shopName: String(shopName).trim(),
          stallLocation: stallLocation ? String(stallLocation).trim() : null,
          categories: Array.isArray(categories) ? categories : [],
          openingHours: openingHours || '06:30 - 18:30',
          photoUrl: photoUrl || null,
          isApproved: true,
        })
        .returning();

      await db
        .insert(merchantBalances)
        .values({ shopId: shop.id })
        .onConflictDoNothing();

      await createAuditLog({
        actorUserId: dbUser.id,
        actorRole: dbUser.role,
        action: 'shop.create',
        entityType: 'merchant_shops',
        entityId: String(shop.id),
      });

      res.json(shop);
    } catch (error) {
      console.error('POST /api/merchant/shops failed:', error);
      res.status(500).json({ error: 'Impossible de créer la boutique.' });
    }
  });

  app.put('/api/merchant/shops/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.id);
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);

      if (!merchantProfile) return res.status(403).json({ error: 'Accès refusé.' });

      const { isOnline, openingHours, stallLocation } = req.body;
      const [updated] = await db
        .update(merchantShops)
        .set({
          ...(typeof isOnline === 'boolean' ? { isOnline } : {}),
          ...(openingHours ? { openingHours } : {}),
          ...(stallLocation !== undefined ? { stallLocation } : {}),
        })
        .where(
          and(
            eq(merchantShops.id, shopId),
            eq(merchantShops.merchantProfileId, merchantProfile.id)
          )
        )
        .returning();

      if (!updated) return res.status(404).json({ error: 'Boutique introuvable.' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de modifier la boutique.' });
    }
  });

  app.post('/api/merchant/shops/:id/products', requireAuth, async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.id);
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Accès refusé.' });

      const [shop] = await db
        .select()
        .from(merchantShops)
        .where(and(eq(merchantShops.id, shopId), eq(merchantShops.merchantProfileId, merchantProfile.id)))
        .limit(1);
      if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });

      const { name, categoryId, unitLabel, unitPriceXof, stockQty, description } = req.body;
      if (!name || !categoryId || !unitPriceXof || Number(unitPriceXof) < 50) {
        return res.status(400).json({ error: 'Produit, catégorie et prix valide (>= 50 FCFA) requis.' });
      }

      const [created] = await db
        .insert(products)
        .values({
          shopId,
          categoryId: Number(categoryId),
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          unitLabel: unitLabel || 'kg',
          unitPriceXof: Math.round(Number(unitPriceXof)),
          stockQty: Number(stockQty ?? 20),
          isAvailable: true,
        })
        .returning();

      res.json(created);
    } catch (error) {
      console.error('POST product failed:', error);
      res.status(500).json({ error: 'Impossible d’ajouter le produit.' });
    }
  });

  app.put('/api/merchant/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const productId = Number(req.params.id);
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Accès refusé.' });

      const [existing] = await db
        .select({ product: products, shop: merchantShops })
        .from(products)
        .innerJoin(merchantShops, eq(products.shopId, merchantShops.id))
        .where(
          and(
            eq(products.id, productId),
            eq(merchantShops.merchantProfileId, merchantProfile.id)
          )
        )
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });

      const { name, unitPriceXof, unitLabel, stockQty, isAvailable } = req.body;
      const [updated] = await db
        .update(products)
        .set({
          ...(name ? { name: String(name).trim() } : {}),
          ...(unitPriceXof ? { unitPriceXof: Math.round(Number(unitPriceXof)) } : {}),
          ...(unitLabel ? { unitLabel } : {}),
          ...(stockQty !== undefined ? { stockQty: Number(stockQty) } : {}),
          ...(typeof isAvailable === 'boolean' ? { isAvailable } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning();

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de mettre à jour le produit.' });
    }
  });

  app.delete('/api/merchant/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const productId = Number(req.params.id);
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Accès refusé.' });

      const [existing] = await db
        .select({ product: products, shop: merchantShops })
        .from(products)
        .innerJoin(merchantShops, eq(products.shopId, merchantShops.id))
        .where(
          and(
            eq(products.id, productId),
            eq(merchantShops.merchantProfileId, merchantProfile.id)
          )
        )
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });

      await db
        .update(products)
        .set({ isAvailable: false, updatedAt: new Date() })
        .where(eq(products.id, productId));

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de désactiver le produit.' });
    }
  });

  app.get('/api/merchant/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);

      if (!merchantProfile) {
        return res.json({ registered: false, shops: [] });
      }

      const shopsData = await db
        .select({ shop: merchantShops, market: markets })
        .from(merchantShops)
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(merchantShops.merchantProfileId, merchantProfile.id));

      const shopIds = shopsData.map((s) => s.shop.id);
      if (shopIds.length === 0) {
        return res.json({ registered: true, merchantProfile, shops: [] });
      }

      const primaryShopId = shopIds[0];
      const [balance] = await db
        .select()
        .from(merchantBalances)
        .where(eq(merchantBalances.shopId, primaryShopId))
        .limit(1);

      const shopOrders = await db
        .select({
          order: orders,
          customerName: users.fullName,
          customerEmail: users.email,
        })
        .from(orders)
        .innerJoin(users, eq(orders.customerUserId, users.id))
        .where(eq(orders.shopId, primaryShopId))
        .orderBy(desc(orders.createdAt))
        .limit(50);

      const shopProducts = await db
        .select({ product: products, category: productCategories })
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(eq(products.shopId, primaryShopId))
        .orderBy(desc(products.createdAt));

      const shopCommissions = await db
        .select()
        .from(commissions)
        .where(eq(commissions.shopId, primaryShopId))
        .orderBy(desc(commissions.createdAt))
        .limit(30);

      const shopPayouts = await db
        .select()
        .from(payouts)
        .where(eq(payouts.shopId, primaryShopId))
        .orderBy(desc(payouts.requestedAt))
        .limit(20);

      const [activeLive] = await db
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.shopId, primaryShopId), eq(liveSessions.status, 'live')))
        .limit(1);

      // Active customer carts for this shop (real-time incoming selections!)
      const activeCarts = await db
        .select({
          cart: carts,
          customerName: users.fullName,
        })
        .from(carts)
        .innerJoin(users, eq(carts.customerUserId, users.id))
        .where(and(eq(carts.shopId, primaryShopId), eq(carts.status, 'active')));

      const activeCartsWithItems = await Promise.all(
        activeCarts.map(async (c) => {
          const items = await db
            .select()
            .from(cartItems)
            .where(eq(cartItems.cartId, c.cart.id));
          return {
            ...c.cart,
            customerName: c.customerName || 'Client',
            items,
          };
        })
      );

      res.json({
        registered: true,
        merchantProfile,
        shops: shopsData.map((s) => ({ ...s.shop, market: s.market })),
        balance: balance || {
          availableBalanceXof: 0,
          pendingEscrowXof: 0,
          totalPaidOutXof: 0,
          totalCommissionsXof: 0,
        },
        orders: shopOrders.map((o) => ({
          ...o.order,
          customerName: o.customerName || o.customerEmail,
        })),
        products: shopProducts.map((p) => ({ ...p.product, category: p.category })),
        commissions: shopCommissions,
        payouts: shopPayouts,
        activeLive: activeLive || null,
        activeCarts: activeCartsWithItems.filter((c) => c.items.length > 0),
      });
    } catch (error) {
      console.error('GET /api/merchant/dashboard failed:', error);
      res.status(500).json({ error: 'Impossible de charger le tableau de bord commerçant.' });
    }
  });

  app.post('/api/merchant/payouts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shopId, amountXof, provider, destinationPhone } = req.body;
      const amount = Math.round(Number(amountXof));
      if (!shopId || !amount || amount < 500 || !destinationPhone) {
        return res.status(400).json({ error: 'Montant minimum 500 FCFA et numéro Mobile Money requis.' });
      }

      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Accès refusé.' });

      const [shop] = await db
        .select()
        .from(merchantShops)
        .where(and(eq(merchantShops.id, Number(shopId)), eq(merchantShops.merchantProfileId, merchantProfile.id)))
        .limit(1);
      if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });

      const [balance] = await db
        .select()
        .from(merchantBalances)
        .where(eq(merchantBalances.shopId, shop.id))
        .limit(1);

      if (!balance || balance.availableBalanceXof < amount) {
        return res.status(400).json({ error: 'Solde disponible insuffisant.' });
      }

      await db
        .update(merchantBalances)
        .set({
          availableBalanceXof: balance.availableBalanceXof - amount,
          totalPaidOutXof: balance.totalPaidOutXof + amount,
          updatedAt: new Date(),
        })
        .where(eq(merchantBalances.shopId, shop.id));

      const [payout] = await db
        .insert(payouts)
        .values({
          shopId: shop.id,
          amountXof: amount,
          provider: provider || merchantProfile.mobileMoneyProvider || 'wave',
          destinationPhone: String(destinationPhone).trim(),
          status: 'processing',
          reference: `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        })
        .returning();

      await createAuditLog({
        actorUserId: req.dbUser!.id,
        actorRole: req.dbUser!.role,
        action: 'merchant.payout_request',
        entityType: 'payouts',
        entityId: String(payout.id),
        details: { amountXof: amount, provider: payout.provider },
      });

      res.json(payout);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’enregistrer la demande de reversement.' });
    }
  });

  // LIVE Session management
  app.post('/api/lives', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shopId, title, cameraFacing, videoQuality } = req.body;
      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Profil commerçant requis.' });

      const [shop] = await db
        .select()
        .from(merchantShops)
        .where(and(eq(merchantShops.id, Number(shopId)), eq(merchantShops.merchantProfileId, merchantProfile.id)))
        .limit(1);
      if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });

      // Close previous open live if any
      await db
        .update(liveSessions)
        .set({ status: 'ended', endedAt: new Date() })
        .where(and(eq(liveSessions.shopId, shop.id), eq(liveSessions.status, 'live')));

      const [session] = await db
        .insert(liveSessions)
        .values({
          shopId: shop.id,
          hostUserId: req.dbUser!.id,
          title: title || `En direct de ${shop.shopName}`,
          status: 'live',
          cameraFacing: cameraFacing === 'user' ? 'user' : 'environment',
          videoQuality: videoQuality || 'auto_3g_4g',
        })
        .returning();

      await db
        .update(merchantShops)
        .set({ isOnline: true })
        .where(eq(merchantShops.id, shop.id));

      // Notify customers who favorited this shop
      db.select({ userId: customerProfiles.userId })
        .from(customerProfiles)
        .where(sql`${customerProfiles.favoriteShopIds} @> ${JSON.stringify([shop.id])}::jsonb`)
        .then((followers) =>
          Promise.allSettled(
            followers
              .filter((f) => f.userId !== req.dbUser!.id)
              .map((f) =>
                createNotification({
                  userId: f.userId,
                  title: `${shop.shopName} est en LIVE !`,
                  body: session.title || `Rejoignez le direct de ${shop.shopName} dès maintenant.`,
                  category: 'live_started',
                  liveSessionId: session.id,
                  url: `/?live=${session.id}`,
                })
              )
          )
        )
        .catch((err) => console.error('Failed to notify favorite followers on live start:', err));

      res.json(session);
    } catch (error) {
      console.error('POST /api/lives failed:', error);
      res.status(500).json({ error: 'Impossible de démarrer le LIVE.' });
    }
  });

  app.post('/api/lives/:id/end', requireAuth, async (req: AuthRequest, res) => {
    try {
      const sessionId = Number(req.params.id);
      const [session] = await db
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.hostUserId, req.dbUser!.id)))
        .limit(1);
      if (!session) return res.status(404).json({ error: 'Session introuvable.' });

      const [ended] = await db
        .update(liveSessions)
        .set({ status: 'ended', endedAt: new Date() })
        .where(eq(liveSessions.id, sessionId))
        .returning();

      await db
        .update(merchantShops)
        .set({ isOnline: false })
        .where(eq(merchantShops.id, session.shopId));

      broadcastToSession(sessionId, 'live:ended', { sessionId });
      res.json(ended);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’arrêter le LIVE.' });
    }
  });

  app.patch('/api/lives/:id/settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const sessionId = Number(req.params.id);
      const { cameraFacing, videoQuality } = req.body;
      const [updated] = await db
        .update(liveSessions)
        .set({
          ...(cameraFacing ? { cameraFacing } : {}),
          ...(videoQuality ? { videoQuality } : {}),
        })
        .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.hostUserId, req.dbUser!.id)))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Session introuvable.' });
      broadcastToSession(sessionId, 'live:settings', updated);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de mettre à jour les réglages LIVE.' });
    }
  });

  // Real-time Interactive Cart & Price Negotiation
  app.get('/api/carts/:shopId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.shopId);
      const [cart] = await db
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.customerUserId, req.dbUser!.id),
            eq(carts.shopId, shopId),
            eq(carts.status, 'active')
          )
        )
        .limit(1);

      if (!cart) return res.json({ cart: null, items: [], subtotalXof: 0 });

      const items = await db
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id))
        .orderBy(cartItems.createdAt);

      const subtotalXof = items.reduce((sum, it) => sum + it.totalPriceXof, 0);
      res.json({ cart, items, subtotalXof });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de charger le panier.' });
    }
  });

  app.post('/api/carts/:shopId/items', requireAuth, async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.shopId);
      const { productId, quantityOrWeight, liveSessionId, notes, customerConfirmed } = req.body;
      const qty = Number(quantityOrWeight);

      if (!productId || !qty || qty <= 0) {
        return res.status(400).json({ error: 'Produit et quantité/poids valides requis.' });
      }

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, Number(productId)), eq(products.shopId, shopId)))
        .limit(1);

      if (!product || !product.isAvailable) {
        return res.status(404).json({ error: 'Produit indisponible dans cette boutique.' });
      }

      let [cart] = await db
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.customerUserId, req.dbUser!.id),
            eq(carts.shopId, shopId),
            eq(carts.status, 'active')
          )
        )
        .limit(1);

      if (!cart) {
        [cart] = await db
          .insert(carts)
          .values({
            customerUserId: req.dbUser!.id,
            shopId,
            liveSessionId: liveSessionId ? Number(liveSessionId) : null,
            status: 'active',
          })
          .returning();
      }

      const totalPriceXof = Math.round(product.unitPriceXof * qty);
      const [item] = await db
        .insert(cartItems)
        .values({
          cartId: cart.id,
          productId: product.id,
          productName: product.name,
          quantityOrWeight: qty,
          unitLabel: product.unitLabel,
          originalUnitPriceXof: product.unitPriceXof,
          unitPriceXof: product.unitPriceXof,
          totalPriceXof,
          priceProposalStatus: 'confirmed',
          customerConfirmed: customerConfirmed !== false,
          notes: notes ? String(notes).trim() : null,
        })
        .returning();

      broadcastToShop(shopId, 'cart:updated', { cartId: cart.id, item });
      if (liveSessionId) {
        broadcastToSession(Number(liveSessionId), 'cart:updated', {
          cartId: cart.id,
          customerName: req.dbUser!.fullName || 'Client',
          item,
        });
      }

      res.json(item);
    } catch (error) {
      console.error('POST cart item failed:', error);
      res.status(500).json({ error: 'Impossible d’ajouter au panier.' });
    }
  });

  app.patch('/api/cart-items/:itemId/propose-price', requireAuth, async (req: AuthRequest, res) => {
    try {
      const itemId = Number(req.params.itemId);
      const proposedUnitPriceXof = Math.round(Number(req.body.proposedUnitPriceXof));
      if (!proposedUnitPriceXof || proposedUnitPriceXof < 50) {
        return res.status(400).json({ error: 'Prix proposé invalide.' });
      }

      const [merchantProfile] = await db
        .select()
        .from(merchantProfiles)
        .where(eq(merchantProfiles.userId, req.dbUser!.id))
        .limit(1);
      if (!merchantProfile) return res.status(403).json({ error: 'Accès commerçant requis.' });

      const rows = await db
        .select({ item: cartItems, cart: carts, shop: merchantShops })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .innerJoin(merchantShops, eq(carts.shopId, merchantShops.id))
        .where(
          and(
            eq(cartItems.id, itemId),
            eq(merchantShops.merchantProfileId, merchantProfile.id)
          )
        )
        .limit(1);

      if (!rows[0]) return res.status(404).json({ error: 'Article introuvable.' });

      const [updated] = await db
        .update(cartItems)
        .set({
          proposedUnitPriceXof,
          priceProposalStatus: 'pending_customer_approval',
          customerConfirmed: false,
          updatedAt: new Date(),
        })
        .where(eq(cartItems.id, itemId))
        .returning();

      broadcastToUser(rows[0].cart.customerUserId, 'cart:price_proposed', updated);
      if (rows[0].cart.liveSessionId) {
        broadcastToSession(rows[0].cart.liveSessionId, 'cart:price_proposed', updated);
      }

      await createNotification({
        userId: rows[0].cart.customerUserId,
        title: 'Proposition de prix du commerçant',
        body: `${rows[0].shop.shopName} propose ${proposedUnitPriceXof.toLocaleString('fr-FR')} FCFA/${updated.unitLabel} pour ${updated.productName}. Votre accord est requis.`,
        category: 'order',
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de proposer un nouveau prix.' });
    }
  });

  app.patch('/api/cart-items/:itemId/respond-price', requireAuth, async (req: AuthRequest, res) => {
    try {
      const itemId = Number(req.params.itemId);
      const approve = Boolean(req.body.approve);

      const rows = await db
        .select({ item: cartItems, cart: carts })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .where(and(eq(cartItems.id, itemId), eq(carts.customerUserId, req.dbUser!.id)))
        .limit(1);

      if (!rows[0]) return res.status(404).json({ error: 'Article introuvable.' });

      const item = rows[0].item;
      const newUnitPrice =
        approve && item.proposedUnitPriceXof ? item.proposedUnitPriceXof : item.unitPriceXof;
      const newTotal = Math.round(newUnitPrice * item.quantityOrWeight);

      const [updated] = await db
        .update(cartItems)
        .set({
          unitPriceXof: newUnitPrice,
          totalPriceXof: newTotal,
          priceProposalStatus: approve ? 'confirmed' : 'rejected',
          customerConfirmed: approve,
          updatedAt: new Date(),
        })
        .where(eq(cartItems.id, itemId))
        .returning();

      broadcastToShop(rows[0].cart.shopId, 'cart:price_responded', updated);
      if (rows[0].cart.liveSessionId) {
        broadcastToSession(rows[0].cart.liveSessionId, 'cart:price_responded', updated);
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de répondre à la proposition.' });
    }
  });

  app.delete('/api/cart-items/:itemId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const itemId = Number(req.params.itemId);
      const rows = await db
        .select({ item: cartItems, cart: carts })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .where(and(eq(cartItems.id, itemId), eq(carts.customerUserId, req.dbUser!.id)))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Article introuvable.' });

      await db.delete(cartItems).where(eq(cartItems.id, itemId));
      broadcastToShop(rows[0].cart.shopId, 'cart:updated', { cartId: rows[0].cart.id, deletedItemId: itemId });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de supprimer l’article.' });
    }
  });

  // Orders Creation & Lifecycle
  app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        shopId,
        deliveryAddress,
        deliveryCity,
        deliveryCommune,
        deliveryQuartier,
        deliveryLat,
        deliveryLng,
        isDiasporaOrder,
        beneficiaryName,
        beneficiaryPhone,
        diasporaMessage,
        displayCurrency,
        fxRateApplied,
      } = req.body;

      if (!shopId || !deliveryAddress || !deliveryCity || !deliveryCommune) {
        return res.status(400).json({ error: 'Adresse de livraison (ville, commune, adresse) requise.' });
      }

      const [cart] = await db
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.customerUserId, req.dbUser!.id),
            eq(carts.shopId, Number(shopId)),
            eq(carts.status, 'active')
          )
        )
        .limit(1);

      if (!cart) return res.status(400).json({ error: 'Votre panier pour cette boutique est vide.' });

      const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
      if (items.length === 0) {
        return res.status(400).json({ error: 'Aucun article dans le panier.' });
      }

      const unapproved = items.find(
        (i) => i.priceProposalStatus === 'pending_customer_approval' || !i.customerConfirmed
      );
      if (unapproved) {
        return res.status(400).json({
          error: `Veuillez d’abord approuver ou refuser la modification de prix pour "${unapproved.productName}".`,
        });
      }

      const itemsSubtotalXof = items.reduce((s, it) => s + it.totalPriceXof, 0);
      // 10% platform commission strictly on goods (excluding delivery)
      const platformCommissionXof = Math.round(itemsSubtotalXof * 0.1);
      const merchantNetXof = itemsSubtotalXof - platformCommissionXof;
      const orderNumber = `ML-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

      const [order] = await db
        .insert(orders)
        .values({
          orderNumber,
          customerUserId: req.dbUser!.id,
          shopId: Number(shopId),
          liveSessionId: cart.liveSessionId,
          status: 'pending_merchant',
          itemsSubtotalXof,
          deliveryFeeXof: 0,
          platformCommissionXof,
          merchantNetXof,
          totalAmountXof: itemsSubtotalXof,
          deliveryAddress: String(deliveryAddress).trim(),
          deliveryCity: String(deliveryCity).trim(),
          deliveryCommune: String(deliveryCommune).trim(),
          deliveryQuartier: deliveryQuartier ? String(deliveryQuartier).trim() : null,
          deliveryLat: typeof deliveryLat === 'number' ? deliveryLat : null,
          deliveryLng: typeof deliveryLng === 'number' ? deliveryLng : null,
          isDiasporaOrder: Boolean(isDiasporaOrder),
          beneficiaryName: beneficiaryName ? String(beneficiaryName).trim() : null,
          beneficiaryPhone: beneficiaryPhone ? String(beneficiaryPhone).trim() : null,
          diasporaMessage: diasporaMessage ? String(diasporaMessage).trim() : null,
          displayCurrency: displayCurrency || 'XOF',
          fxRateApplied: Number(fxRateApplied || 1),
        })
        .returning();

      await db.insert(orderItems).values(
        items.map((i) => ({
          orderId: order.id,
          productId: i.productId,
          productName: i.productName,
          quantityOrWeight: i.quantityOrWeight,
          unitLabel: i.unitLabel,
          unitPriceXof: i.unitPriceXof,
          totalPriceXof: i.totalPriceXof,
          merchantConfirmed: false,
          customerApproved: true,
        }))
      );

      await db
        .update(carts)
        .set({ status: 'converted', updatedAt: new Date() })
        .where(eq(carts.id, cart.id));

      // Notify merchant owner
      const [shopOwner] = await db
        .select({ userId: merchantProfiles.userId, shopName: merchantShops.shopName })
        .from(merchantShops)
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .where(eq(merchantShops.id, Number(shopId)))
        .limit(1);

      if (shopOwner) {
        await createNotification({
          userId: shopOwner.userId,
          title: `Nouvelle commande ${order.orderNumber}`,
          body: `Montant marchandises : ${itemsSubtotalXof.toLocaleString('fr-FR')} FCFA. Confirmez la disponibilité pour commander la livraison.`,
          category: 'order',
          relatedOrderId: order.id,
        });
      }

      broadcastToShop(Number(shopId), 'order:created', order);
      res.json(order);
    } catch (error) {
      console.error('POST /api/orders failed:', error);
      res.status(500).json({ error: 'Impossible de valider la commande.' });
    }
  });

  app.get('/api/orders', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const customerOrders = await db
        .select({
          order: orders,
          shop: merchantShops,
          market: markets,
        })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(orders.customerUserId, dbUser.id))
        .orderBy(desc(orders.createdAt));

      const enriched = await Promise.all(
        customerOrders.map(async (row) => {
          const items = await db
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, row.order.id));
          const [delivery] = await db
            .select()
            .from(deliveryRequests)
            .where(eq(deliveryRequests.orderId, row.order.id))
            .limit(1);
          const orderPayments = await db
            .select()
            .from(payments)
            .where(eq(payments.orderId, row.order.id))
            .orderBy(desc(payments.createdAt));
          return {
            ...row.order,
            shop: row.shop,
            market: row.market,
            items,
            deliveryRequest: delivery || null,
            latestPayment: orderPayments[0] || null,
          };
        })
      );

      res.json(enriched);
    } catch (error) {
      console.error('GET /api/orders failed:', error);
      res.status(500).json({ error: 'Impossible de charger vos commandes.' });
    }
  });

  app.get('/api/orders/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const rows = await db
        .select({
          order: orders,
          shop: merchantShops,
          market: markets,
          merchantUserId: merchantProfiles.userId,
        })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable.' });

      const isAdmin = ['super_admin', 'admin', 'support', 'finance_controller'].includes(
        req.dbUser!.role
      );
      if (
        rows[0].order.customerUserId !== req.dbUser!.id &&
        rows[0].merchantUserId !== req.dbUser!.id &&
        !isAdmin
      ) {
        return res.status(403).json({ error: 'Accès non autorisé à cette commande.' });
      }

      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const [delivery] = await db
        .select()
        .from(deliveryRequests)
        .where(eq(deliveryRequests.orderId, orderId))
        .limit(1);
      const tracking = delivery
        ? await db
            .select()
            .from(deliveryTracking)
            .where(eq(deliveryTracking.deliveryRequestId, delivery.id))
            .orderBy(desc(deliveryTracking.recordedAt))
            .limit(50)
        : [];
      const orderPayments = await db
        .select()
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(desc(payments.createdAt));
      const [orderReview] = await db
        .select({
          review: reviews,
          customerName: users.fullName,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.customerUserId, users.id))
        .where(eq(reviews.orderId, orderId))
        .limit(1);

      res.json({
        ...rows[0].order,
        shop: rows[0].shop,
        market: rows[0].market,
        items,
        deliveryRequest: delivery || null,
        tracking,
        payments: orderPayments,
        review: orderReview
          ? { ...orderReview.review, customerName: orderReview.customerName || 'Client vérifié' }
          : null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de charger la commande.' });
    }
  });

  // Merchant confirms or refuses order
  app.post('/api/orders/:id/merchant-decision', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const accept = Boolean(req.body.accept);

      const rows = await db
        .select({ order: orders, shop: merchantShops, merchantUserId: merchantProfiles.userId })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!rows[0] || rows[0].merchantUserId !== req.dbUser!.id) {
        return res.status(403).json({ error: 'Accès refusé.' });
      }

      const newStatus = accept ? 'merchant_confirmed' : 'cancelled';
      const [updated] = await db
        .update(orders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(orders.id, orderId))
        .returning();

      if (accept) {
        await db
          .update(orderItems)
          .set({ merchantConfirmed: true })
          .where(eq(orderItems.orderId, orderId));
      } else {
        await db
          .update(merchantShops)
          .set({ cancelledOrdersCount: sql`${merchantShops.cancelledOrdersCount} + 1` })
          .where(eq(merchantShops.id, rows[0].shop.id));
        await recalculateStarBadge(rows[0].shop.id);
      }

      await createNotification({
        userId: rows[0].order.customerUserId,
        title: accept
          ? `Commande ${rows[0].order.orderNumber} confirmée`
          : `Commande ${rows[0].order.orderNumber} refusée`,
        body: accept
          ? `${rows[0].shop.shopName} a confirmé la disponibilité. Demande de devis livraison en cours.`
          : `${rows[0].shop.shopName} n’a pas pu honorer cette commande.`,
        category: 'order',
        relatedOrderId: orderId,
      });

      broadcastToUser(rows[0].order.customerUserId, 'order:updated', updated);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de mettre à jour la commande.' });
    }
  });

  // Step 7-9: Merchant clicks "Commander un livreur" -> Yango Delivery API if authorized, else manual courier quote workflow
  app.post('/api/orders/:id/request-delivery-quote', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const rows = await db
        .select({
          order: orders,
          shop: merchantShops,
          market: markets,
          merchantUserId: merchantProfiles.userId,
        })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .innerJoin(markets, eq(merchantShops.marketId, markets.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!rows[0] || rows[0].merchantUserId !== req.dbUser!.id) {
        return res.status(403).json({ error: 'Accès refusé.' });
      }

      const { order, shop, market } = rows[0];
      const yangoKey = process.env.YANGO_DELIVERY_API_KEY;

      // Never fake a Yango price! If YANGO_DELIVERY_API_KEY is configured, call real Yango API; otherwise enter manual courier mode
      if (yangoKey && yangoKey.trim().length > 0) {
        try {
          const yangoRes = await fetch(
            'https://b2b.taxi.yandex.net/b2b/cargo/integration/v2/check-price',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${yangoKey}`,
                'Content-Type': 'application/json',
                'Accept-Language': 'fr',
              },
              body: JSON.stringify({
                route_points: [
                  { coordinates: [market.lng, market.lat], fullname: `${market.name}, ${market.city}` },
                  {
                    coordinates: [order.deliveryLng ?? market.lng, order.deliveryLat ?? market.lat],
                    fullname: `${order.deliveryAddress}, ${order.deliveryCommune}, ${order.deliveryCity}`,
                  },
                ],
              }),
            }
          );

          if (!yangoRes.ok) {
            throw new Error(`Yango API status ${yangoRes.status}`);
          }

          const yangoData = (await yangoRes.json()) as { price?: string };
          const quotedPriceXof = Math.round(Number(yangoData.price || 0));

          const [delivery] = await db
            .insert(deliveryRequests)
            .values({
              orderId: order.id,
              provider: 'yango_delivery',
              status: 'quoted',
              quotedPriceXof,
              pickupAddress: `${shop.shopName} — ${market.name}`,
              pickupLat: market.lat,
              pickupLng: market.lng,
              dropoffAddress: `${order.deliveryAddress}, ${order.deliveryCommune}, ${order.deliveryCity}`,
              dropoffLat: order.deliveryLat,
              dropoffLng: order.deliveryLng,
              customerDecision: 'pending',
            })
            .onConflictDoUpdate({
              target: deliveryRequests.orderId,
              set: {
                provider: 'yango_delivery',
                status: 'quoted',
                quotedPriceXof,
                updatedAt: new Date(),
              },
            })
            .returning();

          await db
            .update(orders)
            .set({ status: 'delivery_quoted', updatedAt: new Date() })
            .where(eq(orders.id, order.id));

          return res.json({ mode: 'yango_delivery', deliveryRequest: delivery });
        } catch (yangoErr) {
          console.error('Yango Delivery API call failed, falling back to manual mode:', yangoErr);
        }
      }

      // Manual fallback mode when Yango API is not yet authorized/configured
      const [delivery] = await db
        .insert(deliveryRequests)
        .values({
          orderId: order.id,
          provider: 'manual_courier',
          status: 'pending_quote',
          quotedPriceXof: null,
          pickupAddress: `${shop.shopName} — ${market.name}`,
          pickupLat: market.lat,
          pickupLng: market.lng,
          dropoffAddress: `${order.deliveryAddress}, ${order.deliveryCommune}, ${order.deliveryCity}`,
          dropoffLat: order.deliveryLat,
          dropoffLng: order.deliveryLng,
          customerDecision: 'pending',
        })
        .onConflictDoUpdate({
          target: deliveryRequests.orderId,
          set: {
            provider: 'manual_courier',
            status: 'pending_quote',
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .update(orders)
        .set({ status: 'awaiting_delivery_quote', updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      res.json({
        mode: 'manual_courier',
        message:
          'API Yango Delivery non configurée : mode livreur manuel activé. Saisissez le tarif réel convenu avec le livreur.',
        deliveryRequest: delivery,
      });
    } catch (error) {
      res.status(500).json({ error: 'Impossible de demander un devis livraison.' });
    }
  });

  app.post('/api/orders/:id/manual-delivery-quote', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const { quotedPriceXof, courierName, courierPhone } = req.body;
      const price = Math.round(Number(quotedPriceXof));
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Montant de livraison réel requis.' });
      }

      const rows = await db
        .select({ order: orders, shop: merchantShops, merchantUserId: merchantProfiles.userId })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!rows[0] || rows[0].merchantUserId !== req.dbUser!.id) {
        return res.status(403).json({ error: 'Accès refusé.' });
      }

      const [delivery] = await db
        .update(deliveryRequests)
        .set({
          quotedPriceXof: price,
          courierName: courierName ? String(courierName).trim() : null,
          courierPhone: courierPhone ? String(courierPhone).trim() : null,
          status: 'quoted',
          customerDecision: 'pending',
          updatedAt: new Date(),
        })
        .where(eq(deliveryRequests.orderId, orderId))
        .returning();

      await db
        .update(orders)
        .set({ status: 'delivery_quoted', updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await createNotification({
        userId: rows[0].order.customerUserId,
        title: `Devis livraison disponible (${price.toLocaleString('fr-FR')} FCFA)`,
        body: `Acceptez ou refusez le tarif de livraison pour la commande ${rows[0].order.orderNumber}.`,
        category: 'delivery',
        relatedOrderId: orderId,
      });

      broadcastToUser(rows[0].order.customerUserId, 'delivery:quoted', delivery);
      res.json(delivery);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’enregistrer le devis de livraison.' });
    }
  });

  app.post('/api/orders/:id/delivery-decision', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const accept = Boolean(req.body.accept);

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.customerUserId, req.dbUser!.id)))
        .limit(1);
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

      const [delivery] = await db
        .select()
        .from(deliveryRequests)
        .where(eq(deliveryRequests.orderId, orderId))
        .limit(1);
      if (!delivery || delivery.quotedPriceXof === null) {
        return res.status(400).json({ error: 'Aucun devis de livraison disponible.' });
      }

      await db
        .update(deliveryRequests)
        .set({
          customerDecision: accept ? 'accepted' : 'rejected',
          status: accept ? 'accepted_by_customer' : 'rejected_by_customer',
          updatedAt: new Date(),
        })
        .where(eq(deliveryRequests.id, delivery.id));

      const deliveryFeeXof = accept ? delivery.quotedPriceXof : 0;
      const totalAmountXof = order.itemsSubtotalXof + deliveryFeeXof;

      const [updatedOrder] = await db
        .update(orders)
        .set({
          deliveryFeeXof,
          totalAmountXof,
          status: accept ? 'awaiting_payment' : 'merchant_confirmed',
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      broadcastToShop(order.shopId, 'order:updated', updatedOrder);
      res.json(updatedOrder);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’enregistrer votre décision.' });
    }
  });

  // Real device/courier GPS tracking update (never fabricated!)
  app.post('/api/orders/:id/delivery-tracking', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const { lat, lng, heading, speedKmh } = req.body;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'Coordonnées GPS réelles (lat, lng) requises.' });
      }

      const [delivery] = await db
        .select()
        .from(deliveryRequests)
        .where(eq(deliveryRequests.orderId, orderId))
        .limit(1);
      if (!delivery) return res.status(404).json({ error: 'Demande de livraison introuvable.' });

      const [point] = await db
        .insert(deliveryTracking)
        .values({
          deliveryRequestId: delivery.id,
          lat,
          lng,
          heading: typeof heading === 'number' ? heading : null,
          speedKmh: typeof speedKmh === 'number' ? speedKmh : null,
          source: 'courier_device_gps',
        })
        .returning();

      if (delivery.status !== 'picked_up' && delivery.status !== 'delivered') {
        await db
          .update(deliveryRequests)
          .set({ status: 'picked_up', updatedAt: new Date() })
          .where(eq(deliveryRequests.id, delivery.id));
        await db
          .update(orders)
          .set({ status: 'in_delivery', updatedAt: new Date() })
          .where(eq(orders.id, orderId));
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (order) {
        broadcastToUser(order.customerUserId, 'delivery:location', { orderId, point });
        broadcastToShop(order.shopId, 'delivery:location', { orderId, point });
      }
      res.json(point);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de mettre à jour la position GPS.' });
    }
  });

  // Real-time delivery tracking simulation step (broadcasts via WebSocket & stores when deliveryRequest exists)
  app.post('/api/orders/:id/simulate-tracking', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const { lat, lng, heading, speedKmh, progressPercent } = req.body;
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'Coordonnées lat/lng valides requises.' });
      }

      const rows = await db
        .select({
          order: orders,
          merchantUserId: merchantProfiles.userId,
        })
        .from(orders)
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable.' });

      const isAdmin = ['super_admin', 'admin', 'support', 'finance_controller'].includes(
        req.dbUser!.role
      );
      if (
        rows[0].order.customerUserId !== req.dbUser!.id &&
        rows[0].merchantUserId !== req.dbUser!.id &&
        !isAdmin
      ) {
        return res.status(403).json({ error: 'Accès non autorisé.' });
      }

      const [delivery] = await db
        .select()
        .from(deliveryRequests)
        .where(eq(deliveryRequests.orderId, orderId))
        .limit(1);

      let point: {
        id: number;
        lat: number;
        lng: number;
        heading: number | null;
        speedKmh: number | null;
        source: string;
        recordedAt: string | Date;
        progressPercent?: number;
      } = {
        id: Date.now(),
        lat,
        lng,
        heading: typeof heading === 'number' ? heading : null,
        speedKmh: typeof speedKmh === 'number' ? speedKmh : 32,
        source: 'simulation',
        recordedAt: new Date().toISOString(),
        progressPercent: typeof progressPercent === 'number' ? progressPercent : undefined,
      };

      if (delivery) {
        const [inserted] = await db
          .insert(deliveryTracking)
          .values({
            deliveryRequestId: delivery.id,
            lat,
            lng,
            heading: typeof heading === 'number' ? heading : null,
            speedKmh: typeof speedKmh === 'number' ? speedKmh : 32,
            source: 'simulation',
          })
          .returning();
        point = {
          ...inserted,
          progressPercent: typeof progressPercent === 'number' ? progressPercent : undefined,
        };
      }

      broadcastToUser(rows[0].order.customerUserId, 'delivery:location', { orderId, point });
      broadcastToShop(rows[0].order.shopId, 'delivery:location', { orderId, point });

      res.json({ ok: true, orderId, point });
    } catch (error) {
      console.error('POST /api/orders/:id/simulate-tracking failed:', error);
      res.status(500).json({ error: 'Impossible de diffuser la position simulée.' });
    }
  });

  // Customer confirms delivery receipt -> releases escrow funds (or marks COD collected) & settles 10% commission
  app.post('/api/orders/:id/confirm-receipt', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.customerUserId, req.dbUser!.id)))
        .limit(1);

      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      if (order.status === 'delivered') return res.json(order);

      const [heldPayment] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.orderId, orderId),
            inArray(payments.status, ['HELD', 'COD_PENDING'])
          )
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (!heldPayment) {
        return res.status(400).json({
          error: 'Aucun paiement confirmé ou à la livraison trouvé pour cette commande.',
        });
      }

      const isCod = heldPayment.status === 'COD_PENDING';

      await db
        .update(payments)
        .set({ status: isCod ? 'COD_COLLECTED' : 'RELEASED', updatedAt: new Date() })
        .where(eq(payments.id, heldPayment.id));

      await db.insert(paymentEvents).values({
        paymentId: heldPayment.id,
        eventType: isCod
          ? 'cod.collected_on_delivery_confirmation'
          : 'escrow.released_on_delivery_confirmation',
        previousStatus: heldPayment.status,
        newStatus: isCod ? 'COD_COLLECTED' : 'RELEASED',
        signatureVerified: true,
        rawPayload: { confirmedByUserId: req.dbUser!.id, isCod },
      });

      await db
        .update(commissions)
        .set({ status: 'settled' })
        .where(eq(commissions.orderId, orderId));

      if (!isCod) {
        await db
          .update(merchantBalances)
          .set({
            pendingEscrowXof: sql`GREATEST(${merchantBalances.pendingEscrowXof} - ${order.merchantNetXof}, 0)`,
            availableBalanceXof: sql`${merchantBalances.availableBalanceXof} + ${order.merchantNetXof}`,
            updatedAt: new Date(),
          })
          .where(eq(merchantBalances.shopId, order.shopId));
      }

      await db
        .update(deliveryRequests)
        .set({ status: 'delivered', updatedAt: new Date() })
        .where(eq(deliveryRequests.orderId, orderId));

      const [updated] = await db
        .update(orders)
        .set({ status: 'delivered', updatedAt: new Date() })
        .where(eq(orders.id, orderId))
        .returning();

      await db
        .update(merchantShops)
        .set({ completedOrdersCount: sql`${merchantShops.completedOrdersCount} + 1` })
        .where(eq(merchantShops.id, order.shopId));

      await recalculateStarBadge(order.shopId);

      await createAuditLog({
        actorUserId: req.dbUser!.id,
        actorRole: req.dbUser!.role,
        action: isCod ? 'order.confirm_receipt_cod' : 'order.confirm_receipt_release',
        entityType: 'orders',
        entityId: String(orderId),
        details: { merchantNetXof: order.merchantNetXof, commissionXof: order.platformCommissionXof, isCod },
      });

      res.json(updated);
    } catch (error) {
      console.error('confirm-receipt failed:', error);
      res.status(500).json({ error: 'Impossible de confirmer la réception.' });
    }
  });

  // Public Mobile Money collection channels (supports zero-API direct transfer & payment links)
  app.get('/api/payments/collection-channels', (_req, res) => {
    res.json({
      wavePhone: process.env.PLATFORM_WAVE_PHONE || null,
      waveLink: process.env.PLATFORM_WAVE_LINK || null,
      orangePhone: process.env.PLATFORM_ORANGE_PHONE || null,
      mtnPhone: process.env.PLATFORM_MTN_PHONE || null,
      moovPhone: process.env.PLATFORM_MOOV_PHONE || null,
      hasApiWebhooks: {
        wave: Boolean(process.env.WAVE_WEBHOOK_SECRET),
        orange_money: Boolean(process.env.ORANGE_MONEY_WEBHOOK_SECRET),
        mtn_momo: Boolean(process.env.MTN_MOMO_WEBHOOK_SECRET),
        moov_money: Boolean(process.env.MOOV_MONEY_WEBHOOK_SECRET),
      },
    });
  });

  // Payment initiation (PENDING for Mobile Money, or COD_PENDING for Cash on Delivery)
  app.post('/api/payments/initiate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { orderId, provider, idempotencyKey } = req.body;
      const allowedProviders = [
        'wave',
        'orange_money',
        'mtn_momo',
        'moov_money',
        'card',
        'cash_on_delivery',
      ];
      if (!orderId || !allowedProviders.includes(provider)) {
        return res.status(400).json({ error: 'Commande et moyen de paiement autorisé requis.' });
      }

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, Number(orderId)), eq(orders.customerUserId, req.dbUser!.id)))
        .limit(1);

      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

      const key = String(idempotencyKey || `idem_${order.id}_${provider}_${Date.now()}`);
      const [existingByKey] = await db
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, key))
        .limit(1);
      if (existingByKey) return res.json(existingByKey);

      const isCod = provider === 'cash_on_delivery';
      const providerRef = `${isCod ? 'COD' : String(provider).toUpperCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const [payment] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          userId: req.dbUser!.id,
          provider,
          providerReference: providerRef,
          idempotencyKey: key,
          amountXof: order.totalAmountXof,
          status: isCod ? 'COD_PENDING' : 'PENDING',
          escrowProvider: isCod ? 'cash_on_delivery' : `${provider}_direct_or_escrow`,
          webhookVerified: false,
        })
        .returning();

      await db.insert(paymentEvents).values({
        paymentId: payment.id,
        eventType: isCod ? 'cod.selected' : 'payment.initiated',
        previousStatus: null,
        newStatus: isCod ? 'COD_PENDING' : 'PENDING',
        signatureVerified: false,
        rawPayload: { provider, amountXof: order.totalAmountXof },
      });

      if (isCod) {
        await db
          .insert(commissions)
          .values({
            orderId: order.id,
            shopId: order.shopId,
            goodsAmountXof: order.itemsSubtotalXof,
            ratePercent: 10,
            commissionAmountXof: order.platformCommissionXof,
            status: 'accrued',
          })
          .onConflictDoNothing();

        const [updatedOrder] = await db
          .update(orders)
          .set({ status: 'paid_preparing', updatedAt: new Date() })
          .where(eq(orders.id, order.id))
          .returning();

        await db
          .update(deliveryRequests)
          .set({ status: 'dispatched', updatedAt: new Date() })
          .where(eq(deliveryRequests.orderId, order.id));

        broadcastToUser(order.customerUserId, 'order:updated', updatedOrder);
        broadcastToShop(order.shopId, 'order:updated', updatedOrder);

        const [shopOwner] = await db
          .select({ userId: merchantProfiles.userId })
          .from(merchantShops)
          .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
          .where(eq(merchantShops.id, order.shopId))
          .limit(1);

        if (shopOwner) {
          await createNotification({
            userId: shopOwner.userId,
            title: `Paiement à la livraison · ${order.orderNumber}`,
            body: `Le client paiera ${order.totalAmountXof.toLocaleString('fr-FR')} FCFA à la livraison. Préparez la commande (commission 10 % suivie au grand livre).`,
            category: 'order',
            relatedOrderId: order.id,
          });
        }
      }

      res.json(payment);
    } catch (error) {
      console.error('POST /api/payments/initiate failed:', error);
      res.status(500).json({ error: 'Impossible d’initier le paiement.' });
    }
  });

  // Customer submits manual Mobile Money transfer proof (zero-API mode)
  app.post('/api/payments/:id/submit-proof', requireAuth, async (req: AuthRequest, res) => {
    try {
      const paymentId = Number(req.params.id);
      const senderPhone = String(req.body.senderPhone || '').trim();
      const transactionRef = String(req.body.transactionRef || '').trim();
      if (!senderPhone || !transactionRef) {
        return res.status(400).json({
          error: 'Votre numéro Mobile Money et la référence/ID du SMS de transfert sont requis.',
        });
      }

      const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.userId, req.dbUser!.id)))
        .limit(1);

      if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' });
      if (payment.status !== 'PENDING') {
        return res.status(400).json({ error: 'Ce paiement n’est plus en attente.' });
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);

      await db.insert(paymentEvents).values({
        paymentId: payment.id,
        eventType: 'payment.manual_proof_submitted',
        previousStatus: 'PENDING',
        newStatus: 'PENDING',
        signatureVerified: false,
        rawPayload: {
          senderPhone,
          transactionRef,
          submittedByUserId: req.dbUser!.id,
          submittedAt: new Date().toISOString(),
        },
      });

      // Notify admins & finance controllers so they can verify on their phone and approve in 1 click
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.role, ['super_admin', 'admin', 'finance_controller']));

      await Promise.all(
        admins.map((adm) =>
          createNotification({
            userId: adm.id,
            title: `Preuve Mobile Money reçue · ${order?.orderNumber || `#${payment.orderId}`}`,
            body: `${payment.amountXof.toLocaleString('fr-FR')} FCFA (${payment.provider}) · Réf : ${transactionRef} · Tél : ${senderPhone}. Vérifiez votre téléphone et validez dans Administration.`,
            category: 'payment',
            relatedOrderId: payment.orderId,
          })
        )
      );

      res.json({ ok: true, message: 'Preuve transmise. En attente de validation par la plateforme.' });
    } catch (error) {
      console.error('POST /api/payments/:id/submit-proof failed:', error);
      res.status(500).json({ error: 'Impossible d’enregistrer la preuve de paiement.' });
    }
  });

  // Secure Payment Webhook Handler (HMAC-SHA256 verified + idempotent state transitions)
  async function processVerifiedWebhook(paymentId: number, eventType: string, rawPayload: Record<string, unknown>, sigVerified: boolean) {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw new Error('Paiement introuvable');
    if (payment.status === 'HELD' || payment.status === 'RELEASED') {
      return payment; // Prevent duplicate processing
    }

    const [order] = await db.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
    if (!order) throw new Error('Commande introuvable');

    if (eventType === 'payment.succeeded') {
      // Transition PENDING -> PAID -> HELD (licensed escrow)
      await db.insert(paymentEvents).values({
        paymentId: payment.id,
        eventType: 'payment.paid_webhook',
        previousStatus: payment.status,
        newStatus: 'PAID',
        signatureVerified: sigVerified,
        rawPayload,
      });

      const [updatedPayment] = await db
        .update(payments)
        .set({ status: 'HELD', webhookVerified: sigVerified, updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning();

      await db.insert(paymentEvents).values({
        paymentId: payment.id,
        eventType: 'payment.escrow_held',
        previousStatus: 'PAID',
        newStatus: 'HELD',
        signatureVerified: sigVerified,
        rawPayload,
      });

      await db
        .insert(commissions)
        .values({
          orderId: order.id,
          shopId: order.shopId,
          goodsAmountXof: order.itemsSubtotalXof,
          ratePercent: 10,
          commissionAmountXof: order.platformCommissionXof,
          status: 'accrued',
        })
        .onConflictDoNothing();

      await db
        .insert(merchantBalances)
        .values({
          shopId: order.shopId,
          pendingEscrowXof: order.merchantNetXof,
          totalCommissionsXof: order.platformCommissionXof,
        })
        .onConflictDoUpdate({
          target: merchantBalances.shopId,
          set: {
            pendingEscrowXof: sql`${merchantBalances.pendingEscrowXof} + ${order.merchantNetXof}`,
            totalCommissionsXof: sql`${merchantBalances.totalCommissionsXof} + ${order.platformCommissionXof}`,
            updatedAt: new Date(),
          },
        });

      const [updatedOrder] = await db
        .update(orders)
        .set({ status: 'paid_preparing', updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();

      await db
        .update(deliveryRequests)
        .set({ status: 'dispatched', updatedAt: new Date() })
        .where(eq(deliveryRequests.orderId, order.id));

      broadcastToUser(order.customerUserId, 'order:updated', updatedOrder);
      broadcastToShop(order.shopId, 'order:updated', updatedOrder);

      await createAuditLog({
        action: 'payment.webhook_held',
        entityType: 'payments',
        entityId: String(payment.id),
        details: { orderId: order.id, provider: payment.provider, amountXof: payment.amountXof },
      });

      return updatedPayment;
    } else {
      const [failed] = await db
        .update(payments)
        .set({ status: 'FAILED', webhookVerified: sigVerified, updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning();

      await db.insert(paymentEvents).values({
        paymentId: payment.id,
        eventType: 'payment.failed_webhook',
        previousStatus: payment.status,
        newStatus: 'FAILED',
        signatureVerified: sigVerified,
        rawPayload,
      });
      return failed;
    }
  }

  app.post('/api/webhooks/payments/:provider', async (req: Request, res: Response) => {
    try {
      const provider = String(req.params.provider);
      const secretEnvMap: Record<string, string | undefined> = {
        wave: process.env.WAVE_WEBHOOK_SECRET,
        orange_money: process.env.ORANGE_MONEY_WEBHOOK_SECRET,
        mtn_momo: process.env.MTN_MOMO_WEBHOOK_SECRET,
        moov_money: process.env.MOOV_MONEY_WEBHOOK_SECRET,
      };
      const secret = secretEnvMap[provider];
      const signature = req.headers['x-webhook-signature'] as string | undefined;

      if (!secret) {
        return res.status(503).json({
          error: `Secret webhook non configuré pour ${provider}. Utilisez l'endpoint Sandbox pour les tests.`,
        });
      }

      const raw = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      if (!signature || signature !== expected) {
        return res.status(401).json({ error: 'Signature webhook invalide.' });
      }

      const { providerReference, eventType } = req.body;
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.providerReference, String(providerReference)))
        .limit(1);

      if (!payment) return res.status(404).json({ error: 'Référence paiement introuvable.' });

      const updated = await processVerifiedWebhook(
        payment.id,
        eventType || 'payment.succeeded',
        req.body,
        true
      );
      res.json({ ok: true, payment: updated });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Erreur de traitement webhook.' });
    }
  });

  // Explicit Sandbox Webhook Test endpoint (when testing without live provider merchant keys)
  app.post('/api/payments/:id/sandbox-webhook', requireAuth, async (req: AuthRequest, res) => {
    try {
      const paymentId = Number(req.params.id);
      const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.userId, req.dbUser!.id)))
        .limit(1);
      if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' });

      const outcome = req.body.outcome === 'failed' ? 'payment.failed' : 'payment.succeeded';
      const updated = await processVerifiedWebhook(
        payment.id,
        outcome,
        { mode: 'sandbox_verification', triggeredBy: req.dbUser!.uid },
        true
      );
      res.json({ ok: true, sandbox: true, payment: updated });
    } catch (error) {
      res.status(500).json({ error: 'Erreur webhook sandbox.' });
    }
  });

  // Verified Reviews & Disputes
  app.post('/api/orders/:id/review', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const { rating, priceRespected, comment } = req.body;
      const r = Number(rating);
      if (!r || r < 1 || r > 5) {
        return res.status(400).json({ error: 'Note entre 1 et 5 requise.' });
      }

      const [order] = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.customerUserId, req.dbUser!.id),
            eq(orders.status, 'delivered')
          )
        )
        .limit(1);
      if (!order) {
        return res.status(400).json({ error: 'Seules les commandes livrées peuvent être évaluées.' });
      }

      const [review] = await db
        .insert(reviews)
        .values({
          orderId,
          shopId: order.shopId,
          customerUserId: req.dbUser!.id,
          rating: r,
          priceRespected: priceRespected !== false,
          comment: comment ? String(comment).trim() : null,
          isVerifiedPurchase: true,
        })
        .returning();

      await recalculateStarBadge(order.shopId);
      res.json({
        ...review,
        customerName: req.dbUser!.fullName || 'Client vérifié',
      });
    } catch (error) {
      res.status(500).json({ error: 'Avis déjà soumis pour cette commande ou erreur serveur.' });
    }
  });

  app.post('/api/orders/:id/dispute', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const { reason, description } = req.body;
      if (!reason || !description) {
        return res.status(400).json({ error: 'Motif et description du litige requis.' });
      }

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.customerUserId, req.dbUser!.id)))
        .limit(1);
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

      const [dispute] = await db
        .insert(disputes)
        .values({
          orderId,
          openedByUserId: req.dbUser!.id,
          reason: String(reason).trim(),
          description: String(description).trim(),
          status: 'open',
        })
        .returning();

      await db
        .update(orders)
        .set({ status: 'disputed', updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await db
        .update(payments)
        .set({ status: 'DISPUTED', updatedAt: new Date() })
        .where(eq(payments.orderId, orderId));

      await createAuditLog({
        actorUserId: req.dbUser!.id,
        actorRole: req.dbUser!.role,
        action: 'dispute.opened',
        entityType: 'disputes',
        entityId: String(dispute.id),
      });

      res.json(dispute);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’ouvrir le litige.' });
    }
  });

  // Admin Back-Office & Multi-Role RBAC
  const adminRoles = ['super_admin', 'admin', 'support', 'finance_controller'];

  // Secure one-time Super Admin bootstrap when zero super_admins exist
  app.post('/api/admin/bootstrap', requireAuth, async (req: AuthRequest, res) => {
    try {
      const existingAdmins = await db
        .select()
        .from(users)
        .where(eq(users.role, 'super_admin'))
        .limit(1);

      if (existingAdmins.length > 0 && req.dbUser!.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Un Super Administrateur existe déjà. Demandez-lui une élévation de rôle.',
        });
      }

      const [updated] = await db
        .update(users)
        .set({ role: 'super_admin', updatedAt: new Date() })
        .where(eq(users.id, req.dbUser!.id))
        .returning();

      await createAuditLog({
        actorUserId: updated.id,
        actorRole: 'super_admin',
        action: 'admin.bootstrap_super_admin',
        entityType: 'users',
        entityId: String(updated.id),
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible d’activer l’accès Super Administrateur.' });
    }
  });

  app.get('/api/admin/overview', requireAuth, requireRoles(adminRoles), async (_req, res) => {
    try {
      const allUsers = await db.select().from(users);
      const allShops = await db
        .select({ shop: merchantShops, market: markets })
        .from(merchantShops)
        .innerJoin(markets, eq(merchantShops.marketId, markets.id));
      const activeLives = await db
        .select()
        .from(liveSessions)
        .where(eq(liveSessions.status, 'live'));
      const allOrders = await db.select().from(orders).orderBy(desc(orders.createdAt));
      const allPayments = await db.select().from(payments);
      const allDisputes = await db.select().from(disputes).orderBy(desc(disputes.createdAt));
      const allDeliveries = await db.select().from(deliveryRequests);
      const allMarkets = await db.select().from(markets).orderBy(markets.city, markets.name);
      const recentAudit = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(30);
      const allCommissions = await db
        .select({
          id: commissions.id,
          orderId: commissions.orderId,
          orderNumber: orders.orderNumber,
          shopId: commissions.shopId,
          shopName: merchantShops.shopName,
          goodsAmountXof: commissions.goodsAmountXof,
          ratePercent: commissions.ratePercent,
          commissionAmountXof: commissions.commissionAmountXof,
          status: commissions.status,
          createdAt: commissions.createdAt,
        })
        .from(commissions)
        .innerJoin(orders, eq(commissions.orderId, orders.id))
        .innerJoin(merchantShops, eq(commissions.shopId, merchantShops.id))
        .orderBy(desc(commissions.createdAt));

      const allPayouts = await db
        .select({
          id: payouts.id,
          shopId: payouts.shopId,
          shopName: merchantShops.shopName,
          amountXof: payouts.amountXof,
          provider: payouts.provider,
          destinationPhone: payouts.destinationPhone,
          status: payouts.status,
          reference: payouts.reference,
          requestedAt: payouts.requestedAt,
          processedAt: payouts.processedAt,
        })
        .from(payouts)
        .innerJoin(merchantShops, eq(payouts.shopId, merchantShops.id))
        .orderBy(desc(payouts.requestedAt));

      const allBalances = await db.select().from(merchantBalances);

      const pendingPaymentRows = await db
        .select({
          payment: payments,
          orderNumber: orders.orderNumber,
          shopName: merchantShops.shopName,
          customerName: users.fullName,
          customerEmail: users.email,
        })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .innerJoin(merchantShops, eq(orders.shopId, merchantShops.id))
        .innerJoin(users, eq(payments.userId, users.id))
        .where(eq(payments.status, 'PENDING'))
        .orderBy(desc(payments.createdAt))
        .limit(30);

      const pendingManualPayments = await Promise.all(
        pendingPaymentRows.map(async (row) => {
          const [proofEvent] = await db
            .select()
            .from(paymentEvents)
            .where(
              and(
                eq(paymentEvents.paymentId, row.payment.id),
                eq(paymentEvents.eventType, 'payment.manual_proof_submitted')
              )
            )
            .orderBy(desc(paymentEvents.createdAt))
            .limit(1);
          const payload = (proofEvent?.rawPayload || {}) as Record<string, unknown>;
          return {
            id: row.payment.id,
            orderId: row.payment.orderId,
            orderNumber: row.orderNumber,
            shopName: row.shopName,
            customerName: row.customerName || row.customerEmail,
            provider: row.payment.provider,
            providerReference: row.payment.providerReference,
            amountXof: row.payment.amountXof,
            senderPhone: typeof payload.senderPhone === 'string' ? payload.senderPhone : null,
            transactionRef:
              typeof payload.transactionRef === 'string' ? payload.transactionRef : null,
            createdAt: row.payment.createdAt,
          };
        })
      );

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const dailyOrders = allOrders.filter((o) => new Date(o.createdAt) >= todayStart);
      const totalRevenueXof = allOrders
        .filter((o) => o.status !== 'cancelled')
        .reduce((s, o) => s + o.totalAmountXof, 0);
      const totalCommissionsXof = allOrders
        .filter((o) => o.status !== 'cancelled')
        .reduce((s, o) => s + o.platformCommissionXof, 0);

      const settledCommissionsXof = allCommissions
        .filter((c) => c.status === 'settled')
        .reduce((s, c) => s + c.commissionAmountXof, 0);
      const accruedCommissionsXof = allCommissions
        .filter((c) => c.status === 'accrued')
        .reduce((s, c) => s + c.commissionAmountXof, 0);
      const refundedCommissionsXof = allCommissions
        .filter((c) => c.status === 'refunded')
        .reduce((s, c) => s + c.commissionAmountXof, 0);
      const totalCollectedGoodsXof = allPayments
        .filter((p) => p.status === 'HELD' || p.status === 'RELEASED' || p.status === 'COD_COLLECTED')
        .reduce((s, p) => s + p.amountXof, 0);
      const merchantEscrowHeldXof = allBalances.reduce((s, b) => s + b.pendingEscrowXof, 0);
      const merchantAvailableXof = allBalances.reduce((s, b) => s + b.availableBalanceXof, 0);
      const merchantPayoutsProcessingXof = allPayouts
        .filter((p) => p.status === 'processing' || p.status === 'requested')
        .reduce((s, p) => s + p.amountXof, 0);
      const merchantPayoutsPaidXof = allPayouts
        .filter((p) => p.status === 'paid')
        .reduce((s, p) => s + p.amountXof, 0);

      const pendingPaymentsCount = allPayments.filter(
        (p) => p.status === 'PENDING' || p.status === 'HELD' || p.status === 'COD_PENDING'
      ).length;
      const inDeliveryCount = allDeliveries.filter(
        (d) => d.status === 'dispatched' || d.status === 'picked_up'
      ).length;

      // City & commune breakdown
      const cityStatsMap: Record<string, { city: string; orders: number; revenueXof: number }> = {};
      for (const o of allOrders) {
        if (o.status === 'cancelled') continue;
        if (!cityStatsMap[o.deliveryCity]) {
          cityStatsMap[o.deliveryCity] = { city: o.deliveryCity, orders: 0, revenueXof: 0 };
        }
        cityStatsMap[o.deliveryCity].orders += 1;
        cityStatsMap[o.deliveryCity].revenueXof += o.totalAmountXof;
      }

      // Market ranking
      const marketStatsMap: Record<number, { marketId: number; name: string; city: string; shops: number; orders: number; revenueXof: number }> = {};
      for (const m of allMarkets) {
        marketStatsMap[m.id] = { marketId: m.id, name: m.name, city: m.city, shops: 0, orders: 0, revenueXof: 0 };
      }
      for (const s of allShops) {
        if (marketStatsMap[s.market.id]) {
          marketStatsMap[s.market.id].shops += 1;
        }
      }
      for (const o of allOrders) {
        const shopRow = allShops.find((s) => s.shop.id === o.shopId);
        if (shopRow && marketStatsMap[shopRow.market.id] && o.status !== 'cancelled') {
          marketStatsMap[shopRow.market.id].orders += 1;
          marketStatsMap[shopRow.market.id].revenueXof += o.totalAmountXof;
        }
      }

      res.json({
        kpis: {
          customersCount: allUsers.filter((u) => u.role === 'customer').length,
          merchantsCount: allUsers.filter((u) => u.role === 'merchant').length,
          connectedMerchantsCount: allShops.filter((s) => s.shop.isOnline).length,
          activeLivesCount: activeLives.length,
          dailyOrdersCount: dailyOrders.length,
          totalOrdersCount: allOrders.length,
          totalRevenueXof,
          totalCommissionsXof,
          inDeliveryCount,
          pendingPaymentsCount,
          openDisputesCount: allDisputes.filter((d) => d.status === 'open').length,
        },
        commissionBreakdown: {
          settledXof: settledCommissionsXof,
          accruedXof: accruedCommissionsXof,
          refundedXof: refundedCommissionsXof,
          totalCollectedGoodsXof,
          merchantEscrowHeldXof,
          merchantAvailableXof,
          merchantPayoutsProcessingXof,
          merchantPayoutsPaidXof,
        },
        pendingManualPayments,
        commissions: allCommissions.slice(0, 50),
        payouts: allPayouts.slice(0, 50),
        users: allUsers,
        markets: allMarkets,
        marketRanking: Object.values(marketStatsMap).sort((a, b) => b.revenueXof - a.revenueXof),
        merchantRanking: allShops
          .map((s) => ({ ...s.shop, marketName: s.market.name, city: s.market.city }))
          .sort((a, b) => b.completedOrdersCount - a.completedOrdersCount),
        cityAnalytics: Object.values(cityStatsMap),
        disputes: allDisputes,
        auditLogs: recentAudit,
      });
    } catch (error) {
      console.error('GET /api/admin/overview failed:', error);
      res.status(500).json({ error: 'Impossible de charger les statistiques admin.' });
    }
  });

  app.post('/api/admin/markets', requireAuth, requireRoles(['super_admin', 'admin']), async (req: AuthRequest, res) => {
    try {
      const { name, city, commune, address, lat, lng, description } = req.body;
      if (!name || !city || !commune || typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'Nom, ville, commune et coordonnées GPS requis.' });
      }
      const [created] = await db
        .insert(markets)
        .values({
          name: String(name).trim(),
          city: String(city).trim(),
          commune: String(commune).trim(),
          address: address || null,
          lat,
          lng,
          description: description || null,
        })
        .returning();
      res.json(created);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de créer le marché.' });
    }
  });

  app.patch('/api/admin/users/:id/role', requireAuth, requireRoles(['super_admin']), async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const { role } = req.body;
      const valid = ['customer', 'merchant', 'super_admin', 'admin', 'support', 'finance_controller'];
      if (!valid.includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide.' });
      }
      const [updated] = await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        .returning();
      await createAuditLog({
        actorUserId: req.dbUser!.id,
        actorRole: req.dbUser!.role,
        action: 'admin.change_role',
        entityType: 'users',
        entityId: String(targetId),
        details: { newRole: role },
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de modifier le rôle.' });
    }
  });

  app.patch('/api/admin/shops/:id/approval', requireAuth, requireRoles(['super_admin', 'admin']), async (req: AuthRequest, res) => {
    try {
      const shopId = Number(req.params.id);
      const isApproved = Boolean(req.body.isApproved);
      const [updated] = await db
        .update(merchantShops)
        .set({ isApproved })
        .where(eq(merchantShops.id, shopId))
        .returning();
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de modifier le statut de la boutique.' });
    }
  });

  app.post('/api/admin/disputes/:id/resolve', requireAuth, requireRoles(['super_admin', 'admin', 'support', 'finance_controller']), async (req: AuthRequest, res) => {
    try {
      const disputeId = Number(req.params.id);
      const { resolution, resolutionNotes } = req.body; // 'resolved_refund' | 'resolved_release'
      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
      if (!dispute) return res.status(404).json({ error: 'Litige introuvable.' });

      const [updated] = await db
        .update(disputes)
        .set({
          status: resolution === 'resolved_refund' ? 'resolved_refund' : 'resolved_release',
          resolutionNotes: resolutionNotes || 'Résolu par l’équipe MARCHÉ LIVE',
          resolvedByUserId: req.dbUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, disputeId))
        .returning();

      const [disputeOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, dispute.orderId))
        .limit(1);

      if (resolution === 'resolved_refund') {
        await db
          .update(payments)
          .set({ status: 'REFUNDED', updatedAt: new Date() })
          .where(eq(payments.orderId, dispute.orderId));
        await db
          .update(orders)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(orders.id, dispute.orderId));
        await db
          .update(commissions)
          .set({ status: 'refunded' })
          .where(eq(commissions.orderId, dispute.orderId));
        if (disputeOrder) {
          await db
            .update(merchantBalances)
            .set({
              pendingEscrowXof: sql`GREATEST(${merchantBalances.pendingEscrowXof} - ${disputeOrder.merchantNetXof}, 0)`,
              totalCommissionsXof: sql`GREATEST(${merchantBalances.totalCommissionsXof} - ${disputeOrder.platformCommissionXof}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(merchantBalances.shopId, disputeOrder.shopId));
        }
      } else {
        await db
          .update(payments)
          .set({ status: 'RELEASED', updatedAt: new Date() })
          .where(eq(payments.orderId, dispute.orderId));
        await db
          .update(orders)
          .set({ status: 'delivered', updatedAt: new Date() })
          .where(eq(orders.id, dispute.orderId));
        await db
          .update(commissions)
          .set({ status: 'settled' })
          .where(eq(commissions.orderId, dispute.orderId));
        if (disputeOrder) {
          await db
            .update(merchantBalances)
            .set({
              pendingEscrowXof: sql`GREATEST(${merchantBalances.pendingEscrowXof} - ${disputeOrder.merchantNetXof}, 0)`,
              availableBalanceXof: sql`${merchantBalances.availableBalanceXof} + ${disputeOrder.merchantNetXof}`,
              updatedAt: new Date(),
            })
            .where(eq(merchantBalances.shopId, disputeOrder.shopId));
        }
      }

      await createAuditLog({
        actorUserId: req.dbUser!.id,
        actorRole: req.dbUser!.role,
        action: 'dispute.resolved',
        entityType: 'disputes',
        entityId: String(disputeId),
        details: { resolution },
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Impossible de résoudre le litige.' });
    }
  });

  // Process / validate merchant 90% payout (10% commission stays retained on platform Mobile Money account)
  app.post(
    '/api/admin/payouts/:id/process',
    requireAuth,
    requireRoles(['super_admin', 'admin', 'finance_controller']),
    async (req: AuthRequest, res) => {
      try {
        const payoutId = Number(req.params.id);
        const { status, reference } = req.body;
        if (status !== 'paid' && status !== 'failed') {
          return res.status(400).json({ error: 'Statut invalide (paid ou failed requis).' });
        }

        const [payout] = await db
          .select()
          .from(payouts)
          .where(eq(payouts.id, payoutId))
          .limit(1);

        if (!payout) return res.status(404).json({ error: 'Demande de reversement introuvable.' });
        if (payout.status === 'paid') {
          return res.status(400).json({ error: 'Ce reversement a déjà été validé comme payé.' });
        }

        const wasPending = payout.status === 'processing' || payout.status === 'requested';
        const [updated] = await db
          .update(payouts)
          .set({
            status,
            reference: reference ? String(reference).trim() : payout.reference,
            processedAt: new Date(),
          })
          .where(eq(payouts.id, payoutId))
          .returning();

        if (status === 'failed' && wasPending) {
          await db
            .update(merchantBalances)
            .set({
              availableBalanceXof: sql`${merchantBalances.availableBalanceXof} + ${payout.amountXof}`,
              totalPaidOutXof: sql`GREATEST(${merchantBalances.totalPaidOutXof} - ${payout.amountXof}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(merchantBalances.shopId, payout.shopId));
        }

        const [shopOwner] = await db
          .select({ userId: merchantProfiles.userId, shopName: merchantShops.shopName })
          .from(merchantShops)
          .innerJoin(merchantProfiles, eq(merchantShops.merchantProfileId, merchantProfiles.id))
          .where(eq(merchantShops.id, payout.shopId))
          .limit(1);

        if (shopOwner) {
          await createNotification({
            userId: shopOwner.userId,
            title:
              status === 'paid'
                ? `Reversement ${payout.amountXof.toLocaleString('fr-FR')} FCFA envoyé`
                : 'Reversement Mobile Money refusé',
            body:
              status === 'paid'
                ? `Votre transfert net (90 %) via ${payout.provider} vers ${payout.destinationPhone} a été effectué (Réf : ${updated.reference || payout.id}).`
                : `Le transfert vers ${payout.destinationPhone} n'a pas abouti. Le montant a été recrédité sur votre solde disponible.`,
            category: 'payment',
          });
        }

        await createAuditLog({
          actorUserId: req.dbUser!.id,
          actorRole: req.dbUser!.role,
          action: `admin.payout_${status}`,
          entityType: 'payouts',
          entityId: String(payoutId),
          details: { amountXof: payout.amountXof, provider: payout.provider, reference: updated.reference },
        });

        res.json(updated);
      } catch (error) {
        console.error('POST /api/admin/payouts/:id/process failed:', error);
        res.status(500).json({ error: 'Impossible de traiter le reversement.' });
      }
    }
  );

  // Admin confirms manual Mobile Money transfer received on platform phone/Wave link (zero-API mode)
  app.post(
    '/api/admin/payments/:id/confirm-manual',
    requireAuth,
    requireRoles(['super_admin', 'admin', 'finance_controller']),
    async (req: AuthRequest, res) => {
      try {
        const paymentId = Number(req.params.id);
        const [payment] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
          .limit(1);

        if (!payment) return res.status(404).json({ error: 'Transaction introuvable.' });

        const updated = await processVerifiedWebhook(
          payment.id,
          'payment.succeeded',
          {
            mode: 'admin_manual_verification',
            verifiedByUserId: req.dbUser!.id,
            note: req.body?.note ? String(req.body.note).trim() : null,
          },
          true
        );

        await createNotification({
          userId: payment.userId,
          title: 'Paiement Mobile Money validé',
          body: `Votre paiement de ${payment.amountXof.toLocaleString('fr-FR')} FCFA a été confirmé. Votre commande est en cours de préparation.`,
          category: 'payment',
          relatedOrderId: payment.orderId,
        });

        res.json({ ok: true, payment: updated });
      } catch (error) {
        console.error('POST /api/admin/payments/:id/confirm-manual failed:', error);
        res.status(500).json({ error: 'Impossible de valider cet encaissement.' });
      }
    }
  );

  // Admin rejects manual Mobile Money transfer if not received
  app.post(
    '/api/admin/payments/:id/reject-manual',
    requireAuth,
    requireRoles(['super_admin', 'admin', 'finance_controller']),
    async (req: AuthRequest, res) => {
      try {
        const paymentId = Number(req.params.id);
        const [payment] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
          .limit(1);

        if (!payment) return res.status(404).json({ error: 'Transaction introuvable.' });

        const updated = await processVerifiedWebhook(
          payment.id,
          'payment.failed',
          {
            mode: 'admin_manual_rejection',
            rejectedByUserId: req.dbUser!.id,
          },
          false
        );

        await createNotification({
          userId: payment.userId,
          title: 'Paiement Mobile Money non reçu',
          body: `Nous n'avons pas retrouvé le transfert de ${payment.amountXof.toLocaleString('fr-FR')} FCFA. Vous pouvez relancer le paiement sur la commande.`,
          category: 'payment',
          relatedOrderId: payment.orderId,
        });

        res.json({ ok: true, payment: updated });
      } catch (error) {
        console.error('POST /api/admin/payments/:id/reject-manual failed:', error);
        res.status(500).json({ error: 'Impossible de rejeter cet encaissement.' });
      }
    }
  );
}
