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
  'expenses', 'contacts', 'events',
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

// ---------- Assistant (Telegram link, persona, email settings, in-app chat) ----------

import {
  getSettings, setSettings, createLinkCode, telegramLinkFor, unlinkTelegram, type UserSettings,
} from './db.js';
import { ask } from './assistant.js';
import { botInfo } from './telegram.js';
import nodemailer from 'nodemailer';
import { MODEL } from './llm.js';

api.get('/assistant/status', authMiddleware, (c) => {
  const { uid } = c.get('user');
  const s = getSettings(uid);
  return c.json({
    bot: botInfo?.username ?? null,
    llm: !!process.env.OPENAI_API_KEY,
    model: MODEL,
    telegram: telegramLinkFor(uid) ?? null,
    settings: { ...s, smtp: s.smtp ? { ...s.smtp, pass: s.smtp.pass ? '••••••••' : '' } : undefined },
  });
});

api.post('/assistant/link-code', authMiddleware, (c) => {
  const { uid } = c.get('user');
  if (!botInfo) return c.json({ error: 'Telegram bot is not running on this server' }, 503);
  const code = createLinkCode(uid);
  return c.json({ code, bot: botInfo.username, deepLink: `https://t.me/${botInfo.username}?start=${code}`, expiresIn: 600 });
});

api.delete('/assistant/telegram', authMiddleware, (c) => {
  unlinkTelegram(c.get('user').uid);
  return c.json({ ok: true });
});

api.post('/assistant/settings', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const body = (await c.req.json()) as Partial<UserSettings>;
  const patch: Partial<UserSettings> = {};
  if (body.persona && ['jarvis', 'neutral', 'terse'].includes(body.persona)) patch.persona = body.persona;
  if (typeof body.humor === 'number') patch.humor = Math.max(0, Math.min(1, body.humor));
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 40);
  if (typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency)) patch.currency = body.currency.toUpperCase();
  if (body.smtp !== undefined) {
    if (body.smtp === null) patch.smtp = undefined;
    else {
      const prev = getSettings(uid).smtp;
      const pass = body.smtp.pass && !/^•+$/.test(body.smtp.pass) ? body.smtp.pass : prev?.pass ?? '';
      patch.smtp = { host: String(body.smtp.host ?? ''), port: Number(body.smtp.port) || 587, user: String(body.smtp.user ?? ''), pass, from: String(body.smtp.from ?? '') };
    }
  }
  const s = setSettings(uid, patch);
  return c.json({ ok: true, settings: { ...s, smtp: s.smtp ? { ...s.smtp, pass: s.smtp.pass ? '••••••••' : '' } : undefined } });
});

api.post('/assistant/test-email', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const s = getSettings(uid).smtp;
  if (!s?.host) return c.json({ ok: false, error: 'SMTP not configured' }, 400);
  try {
    const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
    await t.verify();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});

api.post('/assistant/ask', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const { text } = (await c.req.json()) as { text?: string };
  if (!text?.trim()) return c.json({ error: 'text required' }, 400);
  try {
    return c.json(await ask(uid, text.trim(), 'app'));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ---------- Memory (what JARVIS has learned) ----------

import { listFacts, addFact, deleteFact, setTrust, clearFacts, type Trust } from './memory.js';
import { listPrompts } from './prompts.js';

api.get('/assistant/memory', authMiddleware, (c) => {
  const { uid } = c.get('user');
  return c.json({ facts: listFacts(uid, true) });
});

api.post('/assistant/memory', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const { text } = (await c.req.json()) as { text?: string };
  if (!text?.trim()) return c.json({ error: 'text required' }, 400);
  return c.json({ ok: addFact(uid, text, 'explicit', 'trusted') });
});

api.post('/assistant/memory/:id/trust', authMiddleware, async (c) => {
  const { uid } = c.get('user');
  const { trust } = (await c.req.json()) as { trust: Trust };
  if (!['auto', 'trusted', 'untrusted'].includes(trust)) return c.json({ error: 'bad trust' }, 400);
  return c.json({ ok: setTrust(uid, Number(c.req.param('id')), trust) });
});

api.delete('/assistant/memory/:id', authMiddleware, (c) => {
  const { uid } = c.get('user');
  return c.json({ ok: deleteFact(uid, Number(c.req.param('id'))) });
});

api.delete('/assistant/memory', authMiddleware, (c) => {
  const { uid } = c.get('user');
  return c.json({ ok: true, removed: clearFacts(uid) });
});

// The exact prompt files in use, for vetting. Auth required; no secrets inside.
api.get('/assistant/prompts', authMiddleware, (c) => c.json({ prompts: listPrompts() }));
