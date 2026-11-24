import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { and, eq, sql } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';
import { db } from '../db/index.ts';
import { liveMessages, liveParticipants, liveSessions } from '../db/schema.ts';

interface ClientSocket extends WebSocket {
  clientId: string;
  userId?: number;
  userName?: string;
  sessionId?: number;
  shopId?: number;
  role?: 'host' | 'viewer';
  isAlive: boolean;
}

const clients = new Set<ClientSocket>();

export function broadcastToSession(sessionId: number, event: string, payload: unknown, excludeClientId?: string) {
  const message = JSON.stringify({ event, payload, sessionId });
  for (const client of clients) {
    if (
      client.readyState === WebSocket.OPEN &&
      client.sessionId === sessionId &&
      client.clientId !== excludeClientId
    ) {
      client.send(message);
    }
  }
}

export function broadcastToShop(shopId: number, event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload, shopId });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && client.shopId === shopId) {
      client.send(message);
    }
  }
}

export function broadcastToUser(userId: number, event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(message);
    }
  }
}

export function attachWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const interval = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (socket: WebSocket) => {
    const ws = socket as ClientSocket;
    ws.clientId = `ws_${Math.random().toString(36).slice(2, 10)}`;
    ws.isAlive = true;
    clients.add(ws);

    ws.send(JSON.stringify({ event: 'ws:connected', payload: { clientId: ws.clientId } }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const { event, payload } = data as { event: string; payload: Record<string, any> };

        if (event === 'auth') {
          if (payload?.token) {
            try {
              const decoded = await adminAuth.verifyIdToken(payload.token);
              const dbUser = await getOrCreateUser(
                decoded.uid,
                decoded.email || '',
                decoded.name
              );
              ws.userId = dbUser.id;
              ws.userName = dbUser.fullName || dbUser.email;
              ws.send(JSON.stringify({ event: 'auth:ok', payload: { userId: dbUser.id } }));
            } catch {
              ws.send(JSON.stringify({ event: 'auth:error', payload: { error: 'Token invalide' } }));
            }
          }
          return;
        }

        if (event === 'live:join') {
          const sessionId = Number(payload?.sessionId);
          const shopId = Number(payload?.shopId);
          const role = payload?.role === 'host' ? 'host' : 'viewer';
          if (!sessionId) return;

          ws.sessionId = sessionId;
          ws.shopId = shopId || ws.shopId;
          ws.role = role;

          if (ws.userId) {
            await db.insert(liveParticipants).values({
              sessionId,
              userId: ws.userId,
              role,
              isConnected: true,
            });
          }

          const connectedInRoom = Array.from(clients).filter(
            (c) => c.readyState === WebSocket.OPEN && c.sessionId === sessionId && c.role === 'viewer'
          ).length;

          await db
            .update(liveSessions)
            .set({ viewerCount: connectedInRoom })
            .where(eq(liveSessions.id, sessionId));

          broadcastToSession(sessionId, 'live:presence', {
            sessionId,
            viewerCount: connectedInRoom,
            joinedClientId: ws.clientId,
            role,
          });
          return;
        }

        if (event === 'live:leave') {
          const sessionId = ws.sessionId;
          if (!sessionId) return;
          if (ws.userId) {
            await db
              .update(liveParticipants)
              .set({ isConnected: false, leftAt: new Date() })
              .where(
                and(
                  eq(liveParticipants.sessionId, sessionId),
                  eq(liveParticipants.userId, ws.userId),
                  eq(liveParticipants.isConnected, true)
                )
              );
          }
          ws.sessionId = undefined;
          const connectedInRoom = Array.from(clients).filter(
            (c) => c.readyState === WebSocket.OPEN && c.sessionId === sessionId && c.role === 'viewer'
          ).length;
          await db
            .update(liveSessions)
            .set({ viewerCount: connectedInRoom })
            .where(eq(liveSessions.id, sessionId));
          broadcastToSession(sessionId, 'live:presence', {
            sessionId,
            viewerCount: connectedInRoom,
          });
          return;
        }

        // WebRTC Peer-to-Peer signaling for real bidirectional / live camera streaming
        if (event === 'rtc:offer' || event === 'rtc:answer' || event === 'rtc:ice-candidate') {
          const targetClientId = payload?.targetClientId as string | undefined;
          const sessionId = Number(payload?.sessionId || ws.sessionId);
          if (!sessionId) return;

          for (const client of clients) {
            if (client.readyState !== WebSocket.OPEN || client.sessionId !== sessionId) continue;
            if (targetClientId && client.clientId !== targetClientId) continue;
            if (!targetClientId && client.clientId === ws.clientId) continue;
            client.send(
              JSON.stringify({
                event,
                payload: {
                  ...payload,
                  fromClientId: ws.clientId,
                },
              })
            );
          }
          return;
        }

        // Live chat & camera product inspection requests
        if (event === 'live:chat' || event === 'live:product_request') {
          if (!ws.userId || !ws.sessionId) {
            ws.send(
              JSON.stringify({
                event: 'error',
                payload: { error: 'Connectez-vous pour interagir dans le LIVE.' },
              })
            );
            return;
          }
          const content = String(payload?.content || '').trim().slice(0, 400);
          if (!content) return;

          const messageType = event === 'live:product_request' ? 'product_request' : 'chat';
          const [saved] = await db
            .insert(liveMessages)
            .values({
              sessionId: ws.sessionId,
              userId: ws.userId,
              senderName: ws.userName || 'Client',
              messageType,
              content,
            })
            .returning();

          broadcastToSession(ws.sessionId, 'live:message', saved);
          return;
        }

        // Ephemeral live emoji reactions during a LIVE broadcast
        if (event === 'live:reaction') {
          if (!ws.sessionId) return;
          const allowed = ['❤️', '👏', '🔥', '👋', '👍'];
          const emoji = String(payload?.emoji || '').trim();
          if (!allowed.includes(emoji)) return;

          broadcastToSession(ws.sessionId, 'live:reaction', {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            emoji,
            senderName: ws.userName || 'Visiteur',
          });
          return;
        }
      } catch (err) {
        console.error('WebSocket message handling error:', err);
      }
    });

    ws.on('close', async () => {
      const sessionId = ws.sessionId;
      clients.delete(ws);
      if (sessionId) {
        try {
          if (ws.userId) {
            await db
              .update(liveParticipants)
              .set({ isConnected: false, leftAt: new Date() })
              .where(
                and(
                  eq(liveParticipants.sessionId, sessionId),
                  eq(liveParticipants.userId, ws.userId),
                  eq(liveParticipants.isConnected, true)
                )
              );
          }
          const connectedInRoom = Array.from(clients).filter(
            (c) => c.readyState === WebSocket.OPEN && c.sessionId === sessionId && c.role === 'viewer'
          ).length;
          await db
            .update(liveSessions)
            .set({ viewerCount: sql`GREATEST(${connectedInRoom}, 0)` })
            .where(eq(liveSessions.id, sessionId));
          broadcastToSession(sessionId, 'live:presence', {
            sessionId,
            viewerCount: connectedInRoom,
          });
        } catch (err) {
          console.error('WebSocket disconnect cleanup error:', err);
        }
      }
    });
  });

  return wss;
}
