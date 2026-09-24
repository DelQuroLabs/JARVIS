# Deploying JARVIS to Coolify → https://jarvis.delquro.com

One container: Hono API + SQLite + the built PWA, port 3001. Coolify builds it
from the Dockerfile on every push to `main`.

## 0. Before you start (5 min)

| Need | Where |
|---|---|
| GitHub repo with this code on `main` | e.g. `github.com/DelQuroLabs/JARVIS` (private is fine) |
| DNS `A` record `jarvis.delquro.com` → your Coolify server IP | your DNS provider; also `AAAA` if the box has IPv6 |
| GitHub OAuth App | github.com → Settings → Developer settings → OAuth Apps → New |
| OpenAI API key | platform.openai.com (default model `gpt-5.6-luna`) |
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
   - Port exposed: **3001**
   - Health check: path `/healthz`, port `3001` (the image also has a Docker HEALTHCHECK)
4. **Domains**: `https://jarvis.delquro.com` — Coolify's Traefik issues the Let's Encrypt cert automatically once DNS resolves. Turn on **Force HTTPS**.
5. **Persistent storage → + Volume**: name `jarvis-data`, destination path **`/app/server/data`**. Without this the SQLite DB is wiped on every deploy.
6. **Environment variables** (mark secrets as such):

```
APP_URL=https://jarvis.delquro.com
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…
JWT_SECRET=<openssl rand -hex 32>
OPENAI_API_KEY=sk-…
# optional
TELEGRAM_BOT_TOKEN=…
YOUCOM_API_KEY=…
OPENAI_MODEL=gpt-5.6-luna
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
Assistant screen → status shows `gpt-5.6-luna` and (if set) the Telegram bot username.

## 4. CI/CD

`.github/workflows/ci.yml` runs typecheck + 417 client tests + server tests + build on every push/PR.
Deploy is handled by the Coolify GitHub App webhook (no secrets needed). If you prefer CI to
gate the deploy instead, turn **off** auto-deploy in Coolify and add repo secrets
`COOLIFY_WEBHOOK` (the app's Deploy webhook URL from Coolify → app → Webhooks) and
`COOLIFY_TOKEN` (Coolify → Keys & Tokens → API token); the workflow's `deploy` job then triggers it after checks pass.

## 5. Ops notes

- **Backups**: the whole state is one file, `/app/server/data/jarvis.db`. Coolify → app → Storages → volume → backup, or `docker cp` it out on a cron.
- **Logs**: Coolify → app → Logs. Startup prints `JARVIS server running…` and the Telegram status.
- **Rollback**: Coolify → Deployments → pick a previous successful build → Redeploy.
- **Cost**: Coolify hosting only; OpenAI is pay-per-use on your key (Luna ≈ $0.20/M in, $1.20/M out).
- The PWA share-target and service worker require HTTPS — they work once the cert is live, not on plain http.
