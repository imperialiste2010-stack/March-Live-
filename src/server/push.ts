import * as webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { pushSubscriptions, pushVapidConfig } from '../db/schema.ts';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedVapidKeys: VapidKeys | null = null;
let vapidConfigured = false;

async function ensureVapidKeys(): Promise<VapidKeys> {
  if (cachedVapidKeys && vapidConfigured) {
    return cachedVapidKeys;
  }

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();

  if (envPub && envPriv) {
    cachedVapidKeys = { publicKey: envPub, privateKey: envPriv };
  } else {
    const [existing] = await db.select().from(pushVapidConfig).limit(1);
    if (existing) {
      cachedVapidKeys = {
        publicKey: existing.publicKey,
        privateKey: existing.privateKey,
      };
    } else {
      const generated = webpush.generateVAPIDKeys();
      await db.insert(pushVapidConfig).values({
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
      });
      cachedVapidKeys = generated;
    }
  }

  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@marchelive.ci';
  webpush.setVapidDetails(subject, cachedVapidKeys.publicKey, cachedVapidKeys.privateKey);
  vapidConfigured = true;
  return cachedVapidKeys;
}

export async function getVapidPublicKey(): Promise<string> {
  const keys = await ensureVapidKeys();
  return keys.publicKey;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  category?: string;
  url?: string;
  liveSessionId?: number;
  orderId?: number;
  tag?: string;
}

export async function sendPushToUser(
  userId: number,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number; total: number }> {
  try {
    await ensureVapidKeys();
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    if (subs.length === 0) {
      return { sent: 0, failed: 0, total: 0 };
    }

    const bodyJson = JSON.stringify({
      title: payload.title,
      body: payload.body,
      category: payload.category || 'general',
      url: payload.url || '/',
      liveSessionId: payload.liveSessionId ?? null,
      orderId: payload.orderId ?? null,
      tag: payload.tag || `marche-live-${payload.category || 'general'}`,
    });

    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            bodyJson
          );
          sent += 1;
        } catch (err: unknown) {
          failed += 1;
          const statusCode =
            typeof err === 'object' && err !== null && 'statusCode' in err
              ? Number((err as { statusCode?: number }).statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          }
        }
      })
    );

    return { sent, failed, total: subs.length };
  } catch (err) {
    console.error('sendPushToUser error:', err);
    return { sent: 0, failed: 0, total: 0 };
  }
}
