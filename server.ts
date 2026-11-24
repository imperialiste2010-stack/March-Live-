import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { ensureReferenceDataSeeded } from './src/db/seed.ts';
import { registerApiRoutes } from './src/server/routes.ts';
import { attachWebSocketServer } from './src/server/ws.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sliding-window API rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Security & Mobile Capacitor/WebView CORS headers
  const allowedOrigins = new Set(
    [
      'capacitor://localhost',
      'ionic://localhost',
      'http://localhost',
      'https://localhost',
      'http://localhost:3000',
      process.env.APP_URL,
      ...(process.env.CORS_ORIGINS || '').split(','),
    ]
      .map((v) => v?.trim())
      .filter((v): v is string => Boolean(v))
  );

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // Rate limiting on /api routes
  app.use('/api', (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > 240) {
      return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter quelques secondes.' });
    }
    next();
  });

  // Lazy one-time seeding of Côte d'Ivoire markets & categories on first API call
  app.use('/api', async (_req, _res, next) => {
    await ensureReferenceDataSeeded();
    next();
  });

  // Register REST API routes
  registerApiRoutes(app);

  // Attach real-time WebSocket server for WebRTC LIVE signaling, chat, carts & GPS
  attachWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MARCHÉ LIVE server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MARCHÉ LIVE server:', err);
  process.exit(1);
});
