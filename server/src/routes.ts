// API routes — auth (GitHub OAuth) + sync (last-write-wins).

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { db, upsertUser, findUserById, type DBUser } from './db.js';

type Env = { Variables: { user: JWTPayload } };
export const api = new Hono<Env>();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// ---------- Auth middleware ----------

interface JWTPayload {
  uid: number;
  login: string;
}

/** Extract and verify the Bearer token. Sets c.set('user', ...). */
const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Not authenticated' }, 401);
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as JWTPayload;
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});

// ---------- GitHub OAuth ----------

const GH_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Step 1: redirect the browser to GitHub
api.get('/auth/github', (c) => {
  const params = new URLSearchParams({
    client_id: GH_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/github/callback`,
    scope: 'read:user',
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub redirects back here with ?code=...
api.get('/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing code', 400);

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      client_secret: GH_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) return c.text(`OAuth failed: ${tokenData.error}`, 400);

  // Fetch user profile
  const ghRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'JARVIS',
    },
  });
  const gh = (await ghRes.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };

  // Upsert local user and mint JWT
  const user = upsertUser(gh.id, gh.login, gh.name, gh.avatar_url);
  const token = jwt.sign({ uid: user.id, login: user.login } satisfies JWTPayload, JWT_SECRET, { expiresIn: '90d' });

  // Return an HTML page that posts the token to the opener and closes.
  // This is the popup-based OAuth pattern — the opener (Cloud screen) receives
  // the token via postMessage and stores it.
  return c.html(`<!DOCTYPE html>
<html><head><title>Signing in…</title></head>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#111;color:#eee">
  <p>Signing you in…</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'jarvis-auth', token: '${token}', user: ${JSON.stringify(JSON.stringify({ login: user.login, name: user.name, avatar_url: user.avatar_url }))} }, '*');
        window.close();
      } else {
        // Fallback: redirect with token in hash (won't be sent to server)
        window.location.href = '${APP_URL}#/app/cloud?token=${token}';
      }
    } catch(e) {
      document.body.textContent = 'Auth succeeded but the parent window closed. Close this tab and return to JARVIS.';
    }
  </script>
</body></html>`);
});

// Return current user from the token
api.get('/auth/me', authMiddleware, (c) => {
  const { uid } = c.get('user');
  const user = findUserById(uid);
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({ login: user.login, name: user.name, avatar_url: user.avatar_url });
});

// ---------- Sync ----------

const iso = (ms: number): string => new Date(ms || Date.now()).toISOString();
const ms = (s: string): number => new Date(s).getTime();

interface Row {
  id: string;
  user_id: number;
  updated_at: string;
  payload: string;
}

// All syncable tables
const TABLES = [
  'conversations', 'memory_items', 'workflows', 'skills',
  'routines', 'ideas', 'traces', 'crew_runs', 'projects', 'key_vault',
];

// GET /sync — pull everything for the authenticated user
api.get('/sync', authMiddleware, (c) => {
  const { uid } = c.get('user');
  const result: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(uid) as Row[];
    result[table] = rows.map((r) => ({
      id: r.id,
      updated_at: r.updated_at,
      payload: JSON.parse(r.payload),
    }));
  }

  return c.json(result);
});

// POST /sync — push/pull merge (last-write-wins)
api.post('/sync', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const body = (await c.req.json()) as Record<string, { id: string; updated_at?: number; payload: unknown }[]>;
  const summaries: { table: string; pushed: number; pulled: number; error?: string }[] = [];
  const merged: Record<string, unknown[]> = {};

  const upsert = db.prepare(`INSERT INTO {table} (id, user_id, updated_at, payload) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload
    WHERE excluded.updated_at > {table}.updated_at`);

  for (const table of TABLES) {
    const local = body[table] ?? [];
    const summary = { table, pushed: 0, pulled: 0 };

    try {
      // Pull remote
      const remoteRows = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(uid) as Row[];
      const remoteById = new Map(remoteRows.map((r) => [r.id, r]));
      const localById = new Map(local.map((l) => [l.id, l]));

      // Push: local items newer than remote (or missing)
      for (const item of local) {
        const r = remoteById.get(item.id);
        const localTs = item.updated_at ?? Date.now();
        if (!r || ms(r.updated_at) < localTs) {
          const stmt = db.prepare(`INSERT INTO ${table} (id, user_id, updated_at, payload) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload
            WHERE excluded.updated_at > ${table}.updated_at`);
          stmt.run(item.id, uid, iso(localTs), JSON.stringify(item.payload ?? item));
          summary.pushed++;
        }
      }

      // Pull: remote items newer than local (or missing)
      const result: unknown[] = [];
      for (const r of remoteRows) {
        const l = localById.get(r.id);
        const remotePayload = JSON.parse(r.payload);
        if (!l || (l.updated_at ?? 0) < ms(r.updated_at)) {
          result.push({ id: r.id, updated_at: r.updated_at, payload: remotePayload });
          summary.pulled++;
        } else {
          result.push({ id: r.id, updated_at: r.updated_at, payload: l.payload ?? l });
        }
      }
      // Include local-only items
      for (const l of local) {
        if (!remoteById.has(l.id)) {
          result.push({ id: l.id, updated_at: iso(l.updated_at ?? Date.now()), payload: l.payload ?? l });
        }
      }

      merged[table] = result;
      summaries.push(summary);
    } catch (e) {
      summaries.push({ table, pushed: 0, pulled: 0, error: e instanceof Error ? e.message : 'Unknown error' });
      merged[table] = local.map((l) => ({ id: l.id, updated_at: l.updated_at, payload: l.payload ?? l }));
    }
  }

  return c.json({ ok: summaries.every((s) => !s.error), summaries, merged });
});

// DELETE /sync — purge all user data
api.delete('/sync', authMiddleware, (c) => {
  const { uid } = c.get('user');
  for (const table of TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid);
  }
  return c.json({ ok: true });
});
