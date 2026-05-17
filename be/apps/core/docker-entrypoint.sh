#!/bin/sh
set -eu

# Extract host and port from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_PORT=${DB_PORT:-5432}

echo "[entrypoint] Waiting for database ($DB_HOST:$DB_PORT) to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if node -e "const net=require('net');const s=net.createConnection($DB_PORT,'$DB_HOST');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] Database is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "[entrypoint] Database not ready (attempt $RETRY_COUNT/$MAX_RETRIES), waiting 2 seconds..."
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "[entrypoint] ERROR: Database not ready after $MAX_RETRIES attempts"
  exit 1
fi

echo "[entrypoint] Running database migrations..."
node ./dist/main.js db:migrate

echo "[entrypoint] Starting application..."
exec "$@"
