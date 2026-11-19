#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "==> Syncing database schema for $DATABASE_URL..."
  npx prisma db push --schema=apps/server/prisma/schema.prisma --skip-generate --accept-data-loss
fi

exec "$@"
