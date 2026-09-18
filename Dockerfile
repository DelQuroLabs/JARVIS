FROM node:22-slim AS base
WORKDIR /app

# Install all dependencies (including dev for build steps)
COPY package.json package-lock.json ./
RUN npm ci
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Production image
FROM node:22-slim
WORKDIR /app

COPY --from=base /app/server ./server
COPY --from=base /app/server/node_modules ./server/node_modules
COPY --from=base /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["npx", "tsx", "server/src/index.ts"]
