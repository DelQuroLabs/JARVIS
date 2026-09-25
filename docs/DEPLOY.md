# Deploying JARVIS to Coolify → https://jarvis.delquro.com

One container: Hono API + SQLite + the built PWA, port 3001. Coolify builds it
from the Dockerfile on every push to `main`.

## 0. Before you start (5 min)

| Need | Where |
|---|---|
| GitHub repo with this code on `main` | e.g. `github.com/DelQuroLabs/JARVIS` (private is fine) |
| DNS `A` record `jarvis.delquro.com` → your Coolify server IP | your DNS provider; also `AAAA` if the box has IPv6 |
| GitHub OAuth App | github.com → Settings → Developer settings → OAuth Apps → New |
| OpenAI API key | platform.openai.com (default model `gpt-6-luna`) |
| Telegram bot token (optional) | @BotFather |

GitHub OAuth App values:
- Homepage URL: `https://jarvis.delquro.com`
- **Authorization callback URL: `https://jarvis.delquro.com/api/auth/github/callback`** (exact)

## 1. Push the code

```bash
unzip jarvis.zip -d JARVIS && cd JARVIS
git remote add origin https://github.com/DelQuroLabs/JARVIS.git   # or GitHub Desktop → Publish
git push -u origin main
```

## 2. Coolify (https://coolify.delquro.com)

1. **Sources → GitHub App** (once): create/install the Coolify GitHub App and grant it the `JARVIS` repo. This is what gives auto-deploy on push.
2. **Projects → + New → Add resource → Application → Private repository (GitHub App)** → pick `JARVIS`, branch `main`.
3. Build settings:
   - Build pack: **Dockerfile**
   - Dockerfile location: `/Dockerfile`
   - Ports Exposes: **3001** (Coolify injects this as `PORT`; the server and its health check both follow it, so 3000 also works as long as this field and the health-check port match)
   - Health check: path `/healthz`, port `3001` (the image also has a Docker HEALTHCHECK)
4. **Domains**: `https://jarvis.delquro.com` — Coolify's Traefik issues the Let's Encrypt cert automatically once DNS resolves. Turn on **Force HTTPS**.
5. **Persistent storage → + Volume**: name `jarvis-data`, destination path **`/app/server/data`**. Without this the SQLite DB is wiped on every deploy.
6. **Environment variables** (mark secrets as such):

```
APP_URL=https://jarvis.delquro.com
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…
JWT_SECRET=<openssl rand -hex 32>
ALLOWED_GITHUB_LOGINS=your-github-login      # who may log in; empty = first sign-in claims ownership
SSO_COOKIE_DOMAIN=delquro.com                # optional: JARVIS as the front door for other *.delquro.com apps (§4c)
OPENAI_API_KEY=sk-…
# optional
TELEGRAM_BOT_TOKEN=…
YOUCOM_API_KEY=…
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=low
```
   Do **not** set `PORT` or `DB_PATH` — the image sets them.
7. **Deploy**. First build ≈ 3–4 min (two `npm ci` + Vite build).

## 3. Verify

```
curl https://jarvis.delquro.com/healthz          → {"ok":true}
curl -I https://jarvis.delquro.com/               → 200 text/html
```
Open the site → Settings → Cloud sync → **Sign in with GitHub** → should round-trip and show your handle.
Assistant screen → status shows `gpt-6-luna` and (if set) the Telegram bot username.

## 4. CI/CD

`.github/workflows/ci.yml` runs typecheck + 417 client tests + server tests + build on every push/PR.
Deploy is handled by the Coolify GitHub App webhook (no secrets needed). If you prefer CI to
gate the deploy instead, turn **off** auto-deploy in Coolify and add repo secrets
`COOLIFY_WEBHOOK` (the app's Deploy webhook URL from Coolify → app → Webhooks) and
`COOLIFY_TOKEN` (Coolify → Keys & Tokens → API token); the workflow's `deploy` job then triggers it after checks pass.

## 4b. Login / access control

The site shows a **login wall** before anything loads (whenever GitHub OAuth is configured).
Only allowed GitHub accounts get in:
- `ALLOWED_GITHUB_LOGINS=alice,bob` → exactly those accounts.
- unset → the **first** account to sign in becomes the owner and the door closes; add
  others later via the env var (restart after changing it).
Everything under `/api` (sync, assistant, memory, the OpenAI key) already required a
valid token; the wall stops strangers from even reaching the app UI. Set
`REQUIRE_LOGIN=false` to run it open (e.g. a purely local-first demo).

## 4c. JARVIS as the front door for your other apps (SSO)

Set `SSO_COOKIE_DOMAIN=delquro.com`. From then on a successful sign-in also leaves an
HttpOnly `jarvis_sso` cookie on `.delquro.com`, and JARVIS answers
`GET https://jarvis.delquro.com/api/auth/verify`:

- **200** `{ok:true, login, name, avatar_url}` + headers `X-Auth-User`, `X-Auth-Name` —
  signed in *and* still on the allow list.
- **401** (or a 302 to sign in when called by a proxy) — not signed in / not allowed.

Three ways to use it, from zero code to a few lines:

**A. Any app on Coolify, zero code (Traefik ForwardAuth).** Coolify → the other app →
*Advanced → Custom Docker labels* (or `labels:` in its compose), add:

```
traefik.http.middlewares.jarvis-auth.forwardauth.address=https://jarvis.delquro.com/api/auth/verify
traefik.http.middlewares.jarvis-auth.forwardauth.trustForwardHeader=true
traefik.http.middlewares.jarvis-auth.forwardauth.authResponseHeaders=X-Auth-User,X-Auth-Name
traefik.http.routers.<that-app's-router-name>.middlewares=jarvis-auth
```

(The router name is in the labels Coolify already generated for that app — usually
`http-0-<uuid>` / `https-0-<uuid>`. Attach the middleware to the https one.)
Unauthenticated visitors are bounced to GitHub sign-in and returned to the exact URL
they asked for. The app receives the user in the `X-Auth-User` request header.

**B. A front end calling JARVIS directly.**

```js
const r = await fetch('https://jarvis.delquro.com/api/auth/verify?mode=json', { credentials: 'include' });
if (r.status === 401) location.href = 'https://jarvis.delquro.com/api/auth/github?return_to=' + encodeURIComponent(location.href);
const me = await r.json(); // { login, name, avatar_url }
```

**C. A Node/Express back end.**

```js
app.use(async (req, res, next) => {
  const r = await fetch('https://jarvis.delquro.com/api/auth/verify?mode=json', { headers: { cookie: req.headers.cookie || '' } });
  if (!r.ok) return res.redirect('https://jarvis.delquro.com/api/auth/github?return_to=' + encodeURIComponent(`https://${req.headers.host}${req.originalUrl}`));
  req.user = await r.json();
  next();
});
```

Sign out everywhere: `https://jarvis.delquro.com/api/auth/logout?return_to=<url>`.
`return_to` is only honoured for URLs on the SSO domain (no open redirect); everything
else falls back to the JARVIS home. Who is allowed is still one setting:
`ALLOWED_GITHUB_LOGINS`. Removing someone there locks them out of every app at once.

Limits (by design): cookie SSO only works for apps on the same parent domain and in a
browser. Native mobile apps or other domains would need the full OIDC provider — a
planned extension, not part of this.

## 5. Ops notes

- **Backups**: the whole state is one file, `/app/server/data/jarvis.db`. Coolify → app → Storages → volume → backup, or `docker cp` it out on a cron.
- **Logs**: Coolify → app → Logs. Startup prints `JARVIS server running…` and the Telegram status.
- **Rollback**: Coolify → Deployments → pick a previous successful build → Redeploy.
- **Cost**: Coolify hosting only; OpenAI is pay-per-use on your key (Luna ≈ $0.20/M in, $1.20/M out).
- The PWA share-target and service worker require HTTPS — they work once the cert is live, not on plain http.
