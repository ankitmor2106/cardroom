# ── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/game-engines/package.json ./packages/game-engines/
COPY packages/validation/package.json ./packages/validation/

# Install all deps
RUN npm install --no-audit --no-fund

# Copy source
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY apps/server/ ./apps/server/

# Build the React app
RUN npm --workspace @cardroom/web run build

# Generate Prisma client
RUN npm --workspace @cardroom/server run db:generate

# ── Stage 2: Lean runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV WEB_DIST_PATH=/app/apps/web/dist

# Copy only what's needed to run
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

# Install production deps only
RUN npm install --no-audit --no-fund --omit=dev

# Copy the built Prisma client and React dist from build stage
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Persistent SQLite data directory
RUN mkdir -p /app/data

EXPOSE 4000

CMD ["npm", "--workspace", "@cardroom/server", "run", "start"]
