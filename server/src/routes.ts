// API routes — auth (GitHub OAuth) + sync (last-write-wins).

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { SSO_COOKIE, ssoCookieDomain, safeReturnTo, isTrustedOrigin, parseCookies, ssoSetCookie, ssoClearCookie, forwardedUrl } from './sso.js';
import { randomBytes } from 'node:crypto';
import { db, upsertUser, findUserById, getMeta, setMeta, type DBUser } from './db.js';

type Env = { Variables: { user: JWTPayload } };
export const api = new Hono<Env>();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// ---------- Auth middleware ----------

interface JWTPayload {
  uid: number;
  login: string;
}

/** Extract and verify the Bearer token. Sets c.set('user', ...). */
/** Session token from the Authorization header, else the SSO cookie. */
function tokenFrom(c: { req: { header: (n: string) => string | undefined } }): string | null {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return parseCookies(c.req.header('Cookie'))[SSO_COOKIE] || null;
}

const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
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

/**
 * Who may sign in. This is a personal deployment: without a gate, anyone with a
 * GitHub account could log in and spend the server's OpenAI key.
 *  - ALLOWED_GITHUB_LOGINS="alice,bob" → only those logins (case-insensitive).
 *  - unset → the FIRST person to sign in becomes the owner and the door closes
 *    behind them (recorded in the DB; add more people via the env var).
 * REQUIRE_LOGIN=false turns the client-side wall off (API stays authenticated).
 */
const ALLOWED = new Set((process.env.ALLOWED_GITHUB_LOGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const SSO_DOMAIN = ssoCookieDomain();
const SECURE = () => APP_URL.startsWith('https');
const REQUIRE_LOGIN = (process.env.REQUIRE_LOGIN ?? (GH_CLIENT_ID ? 'true' : 'false')) !== 'false';

function isAllowed(login: string): { ok: boolean; reason?: string } {
  const l = login.toLowerCase();
  if (ALLOWED.size) return ALLOWED.has(l) ? { ok: true } : { ok: false, reason: 'not on the allow list' };
  const owner = getMeta('owner_login');
  if (!owner) { setMeta('owner_login', l); return { ok: true }; }
  return owner === l ? { ok: true } : { ok: false, reason: 'this JARVIS already has an owner' };
}

/** Public: tells the client whether to show the login wall before the app. */
api.get('/auth/config', (c) => c.json({
  requireLogin: REQUIRE_LOGIN,
  configured: !!GH_CLIENT_ID && !!GH_CLIENT_SECRET,
  gate: ALLOWED.size ? 'allowlist' : getMeta('owner_login') ? 'owner' : 'first-user-claims',
  sso: SSO_DOMAIN || null,
}));

const STATE_COOKIE = 'jarvis_oauth_state';
const cookieOpts = () => `Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${APP_URL.startsWith('https') ? '; Secure' : ''}`;

// Step 1: redirect the browser to GitHub (with a CSRF state nonce)
api.get('/auth/github', (c) => {
  if (!GH_CLIENT_ID) return c.text('GitHub sign-in is not configured on this server (GITHUB_CLIENT_ID missing).', 503);
  const state = randomBytes(16).toString('hex');
  // Where to land in the app afterwards (a hash route only; nothing else is honoured).
  const back = (c.req.query('back') || '').replace(/[^#/A-Za-z0-9_-]/g, '').slice(0, 80);
  // Sibling apps send an absolute return_to; only trusted hosts survive.
  const returnTo = safeReturnTo(c.req.query('return_to'), APP_URL, SSO_DOMAIN);
  c.header('Set-Cookie', `${STATE_COOKIE}=${state}.${encodeURIComponent(returnTo || back)}; ${cookieOpts()}`);
  const params = new URLSearchParams({
    client_id: GH_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/github/callback`,
    scope: 'read:user',
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * End of the sign-in dance: send the browser back to the app with the result
 * in the URL fragment. Fragments never reach a server or its logs, and a
 * plain redirect works where pop-ups and postMessage are blocked.
 */
const finish = (r: { token?: string; error?: string; back?: string }) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (r.token && SSO_DOMAIN) headers.append('Set-Cookie', ssoSetCookie(r.token, SSO_DOMAIN, SECURE()));
  const absolute = safeReturnTo(r.back, APP_URL, SSO_DOMAIN);
  if (absolute && !absolute.startsWith(APP_URL)) {
    // A sibling app sent this visitor. Success: straight back, the cookie does the rest.
    // Failure: show the message on the JARVIS wall instead.
    if (r.token) { headers.set('Location', absolute); return new Response(null, { status: 302, headers }); }
    headers.set('Location', `${APP_URL}/#auth_error=${encodeURIComponent(r.error || 'Sign-in failed')}`);
    return new Response(null, { status: 302, headers });
  }
  const q = r.token ? `#auth=${encodeURIComponent(r.token)}` : `#auth_error=${encodeURIComponent(r.error || 'Sign-in failed')}`;
  const back = r.back && !absolute ? `&back=${encodeURIComponent(r.back)}` : '';
  headers.set('Location', `${APP_URL}/${q}${back}`);
  return new Response(null, { status: 302, headers });
};

// Step 2: GitHub redirects back here with ?code=...&state=...
api.get('/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return finish({ error: c.req.query('error_description') || 'GitHub did not return a code.' });
  const state = c.req.query('state') || '';
  const raw = (c.req.header('Cookie') || '').split(/;\s*/).find((x) => x.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) || '';
  const dot = raw.indexOf('.');
  const cookie = dot === -1 ? raw : raw.slice(0, dot);
  const back = dot === -1 ? '' : decodeURIComponent(raw.slice(dot + 1));
  c.header('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth; Max-Age=0`);
  if (!state || !cookie || state !== cookie) return finish({ error: 'Sign-in state mismatch (cookies blocked or the link expired). Try again.' });
  const finishBack = (r: { token?: string; error?: string }) => finish({ ...r, back });

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
  if (!tokenData.access_token) return finishBack({ error: `GitHub rejected the sign-in (${tokenData.error || 'unknown error'}).` });

  // Fetch user profile
  const ghRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'JARVIS',
    },
  });
  const gh = (await ghRes.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
  if (!gh?.login) return finishBack({ error: 'GitHub did not return a profile.' });

  const gate = isAllowed(gh.login);
  if (!gate.ok) return finishBack({ error: `Signed in as @${gh.login}, but this JARVIS is private (${gate.reason ?? 'not allowed'}). Ask the owner to add you to ALLOWED_GITHUB_LOGINS.` });

  // Upsert local user and mint JWT
  const user = upsertUser(gh.id, gh.login, gh.name, gh.avatar_url);
  const token = jwt.sign({ uid: user.id, login: user.login } satisfies JWTPayload, JWT_SECRET, { expiresIn: '90d' });

  return finishBack({ token });
});

// Return current user from the token
api.get('/auth/me', authMiddleware, (c) => {
  const { uid } = c.get('user');
  const user = findUserById(uid);
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({ login: user.login, name: user.name, avatar_url: user.avatar_url });
});

// ---------- SSO for sibling apps ----------

/**
 * "Is this browser signed in and allowed?" for other apps on the SSO domain.
 * Works two ways:
 *  - Traefik/Coolify ForwardAuth: proxy calls this with the visitor's cookies
 *    and X-Forwarded-*; 200 lets the request through (X-Auth-User set),
 *    anything else and the visitor is redirected to sign in and brought back.
 *  - Direct fetch from an app's front end with credentials: 'include' -
 *    200 + JSON user, or 401.
 * Add ?mode=json to get a 401 instead of a redirect when unauthenticated.
 */
api.get('/auth/verify', (c) => {
  const origin = c.req.header('Origin');
  if (origin && isTrustedOrigin(origin, APP_URL, SSO_DOMAIN)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
  c.header('Cache-Control', 'no-store');
  const token = tokenFrom(c);
  let user: DBUser | undefined;
  if (token) {
    try {
      const { uid } = jwt.verify(token, JWT_SECRET) as JWTPayload;
      user = findUserById(uid);
      if (user && !isAllowed(user.login).ok) user = undefined; // allow list can shrink later
    } catch { user = undefined; }
  }
  if (user) {
    c.header('X-Auth-User', user.login);
    c.header('X-Auth-Name', user.name || '');
    return c.json({ ok: true, login: user.login, name: user.name, avatar_url: user.avatar_url });
  }
  const wanted = forwardedUrl((n) => c.req.header(n));
  const wantsJson = c.req.query('mode') === 'json' || !wanted || (c.req.header('Accept') || '').includes('application/json');
  if (wantsJson) return c.json({ ok: false, error: 'Not authenticated', login_url: `${APP_URL}/api/auth/github` }, 401);
  return c.redirect(`${APP_URL}/api/auth/github?return_to=${encodeURIComponent(wanted)}`, 302);
});

/** Sign out everywhere on the SSO domain (cookie), then go back. */
api.get('/auth/logout', (c) => {
  if (SSO_DOMAIN) c.header('Set-Cookie', ssoClearCookie(SSO_DOMAIN, SECURE()));
  const to = safeReturnTo(c.req.query('return_to'), APP_URL, SSO_DOMAIN) || `${APP_URL}/`;
  return c.redirect(to, 302);
});
api.post('/auth/logout', (c) => {
  if (SSO_DOMAIN) c.header('Set-Cookie', ssoClearCookie(SSO_DOMAIN, SECURE()));
  return c.json({ ok: true });
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
