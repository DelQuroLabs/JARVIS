# Push JARVIS to GitHub

This zip is a complete git repository (history included, secrets scrubbed).

## Option A — GitHub Desktop (no terminal)
1. Unzip to a folder, e.g. `C:\Code\JARVIS` or `~/Code/JARVIS`.
2. GitHub Desktop → File → **Add local repository** → pick that folder.
3. Click **Publish repository** → name `JARVIS`, owner `DelQuroLabs`, keep it private → Publish.

## Option B — command line (HTTPS)
```bash
cd JARVIS
git remote add origin https://github.com/DelQuroLabs/JARVIS.git
git push -u origin main
```
If the push says "Repository not found", create the empty repo first at
https://github.com/new (no README/.gitignore), and make sure the CLI is signed in
(`gh auth login`, or use GitHub Desktop which is already authenticated).

## Then
Follow `docs/DEPLOY.md` to connect the repo to Coolify at https://coolify.delquro.com
and put it live on https://jarvis.delquro.com.

What is NOT in this zip (on purpose): node_modules, dist, server/data, server/.env.
`.gitignore` keeps them out of GitHub too; Coolify rebuilds everything from the Dockerfile.
