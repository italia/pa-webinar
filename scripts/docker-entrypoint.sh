#!/bin/sh
set -e

# Parse host:port from DATABASE_URL for readiness check
if [ -n "$DATABASE_URL" ]; then
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\2|')
fi
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"

check_db() {
  node -e "
    const s = require('net').createConnection(${DB_PORT}, '${DB_HOST}')
      .on('connect', () => { s.end(); process.exit(0); })
      .on('error',   () => process.exit(1));
    setTimeout(() => process.exit(1), 1000);
  " 2>/dev/null
}

echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
i=0
while [ "$i" -lt 30 ]; do
  if check_db; then
    echo "Database is ready"
    break
  fi
  i=$((i + 1))
  echo "  attempt ${i}/30 — retrying in 2s..."
  sleep 2
done

if [ "$i" -eq 30 ]; then
  echo "ERROR: database not reachable after 60s. Aborting startup."
  exit 1
fi

# Note: Database migrations are NOT run here. The production runner image
# does not include npm/npx (stripped for security and image size).
# Migrations must be applied before starting the app:
#   - Kubernetes: via the db-migrate initContainer (see Helm chart)
#   - Docker Compose: via the db-migrate service (profile: setup)
#   - Manual: npx prisma migrate deploy (from the builder image)

exec "$@"
