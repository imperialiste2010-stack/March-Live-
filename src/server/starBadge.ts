import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { merchantShops, reviews } from '../db/schema.ts';

/**
 * Evaluates and updates the measurable "Commerçant Star" badge for a shop:
 * - Average rating >= 4.5
 * - Completed orders >= 5
 * - Cancellation rate <= 10%
 * - Price respect rate >= 95%
 * - Verified customer reviews >= 3
 */
export async function recalculateStarBadge(shopId: number) {
  const [shop] = await db
    .select()
    .from(merchantShops)
    .where(eq(merchantShops.id, shopId))
    .limit(1);

  if (!shop) return null;

  const shopReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.shopId, shopId));

  const verifiedReviews = shopReviews.filter((r) => r.isVerifiedPurchase);
  const reviewCount = verifiedReviews.length;
  const ratingAvg =
    reviewCount > 0
      ? Number(
          (verifiedReviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount).toFixed(2)
        )
      : 0;

  const priceRespectCount = verifiedReviews.filter((r) => r.priceRespected).length;
  const priceRespectRate =
    reviewCount > 0 ? Number(((priceRespectCount / reviewCount) * 100).toFixed(1)) : 100;

  const totalOrders = shop.completedOrdersCount + shop.cancelledOrdersCount;
  const cancellationRate =
    totalOrders > 0 ? (shop.cancelledOrdersCount / totalOrders) * 100 : 0;

  const qualifies =
    ratingAvg >= 4.5 &&
    shop.completedOrdersCount >= 5 &&
    cancellationRate <= 10 &&
    priceRespectRate >= 95 &&
    reviewCount >= 3;

  const starReason = qualifies
    ? `Note ${ratingAvg}/5 · ${shop.completedOrdersCount} commandes livrées · ${priceRespectRate}% respect des prix`
    : `Critères requis : note >= 4,5 (${ratingAvg}), >= 5 commandes (${shop.completedOrdersCount}), >= 3 avis (${reviewCount}), annulation <= 10% (${cancellationRate.toFixed(1)}%)`;

  const [updated] = await db
    .update(merchantShops)
    .set({
      ratingAvg,
      reviewCount,
      priceRespectRate,
      isStarMerchant: qualifies,
      starReason,
    })
    .where(eq(merchantShops.id, shopId))
    .returning();

  return updated;
}
