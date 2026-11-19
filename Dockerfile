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

# Install all dependencies
RUN npm install --no-audit --no-fund

# Copy source code
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY apps/server/ ./apps/server/

# Build the React app
RUN npm --workspace @cardroom/web run build

# ── Stage 2: Lean runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV WEB_DIST_PATH=/app/apps/web/dist

# Copy package manifests & source needed to run
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

# Install production dependencies (includes prisma CLI, tsx, fastify, etc.)
RUN npm install --no-audit --no-fund --omit=dev

# Generate Prisma Client natively inside the runner image
RUN npm --workspace @cardroom/server run db:generate

# Copy the built React dist from build stage
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Create persistent data directory and copy entrypoint script
RUN mkdir -p /app/data

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "--workspace", "@cardroom/server", "run", "start"]
