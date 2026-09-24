# ---- build stage -----------------------------------------------------------
FROM node:22-slim AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci

COPY . .
# Regenerates src/core/prompts.gen.ts from prompts/*.md, typechecks, builds the PWA.
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# SQLite lives on a persistent volume; mount /app/server/data in Coolify.
ENV DB_PATH=/app/server/data/jarvis.db

COPY --from=base /app/server ./server
COPY --from=base /app/dist ./dist
RUN mkdir -p /app/server/data

# Run from the server directory so its own node_modules (tsx included) are used;
# nothing is downloaded at container start.
WORKDIR /app/server
EXPOSE 3001
# Health check follows $PORT so a platform that overrides it (Coolify does) still passes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "--no-install", "tsx", "src/index.ts"]
