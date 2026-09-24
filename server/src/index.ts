// JARVIS API server — Hono + SQLite.
// Serves the API and (in production) the built frontend.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { startTelegram } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = new Hono();

const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

// CORS — wide open in dev, same-origin in prod
app.use('/api/*', cors({
  origin: isProd ? '*' : ['http://localhost:5173', 'http://localhost:3001'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Mount all API routes under /api
app.route('/api', api);

// Health check
app.get('/healthz', (c) => c.json({ ok: true }));

// In production, serve the Vite build
if (isProd) {
  const distDir = path.resolve(__dirname, '..', '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use('/*', serveStatic({ root: distDir }));
    // SPA fallback — any non-API, non-file route returns index.html
    app.get('*', (c) => {
      const index = path.join(distDir, 'index.html');
      if (fs.existsSync(index)) {
        return c.html(fs.readFileSync(index, 'utf-8'));
      }
      return c.text('Not found', 404);
    });
  }
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`JARVIS server running on http://localhost:${info.port}`);
  void startTelegram();
});
