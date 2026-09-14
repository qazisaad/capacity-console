#!/usr/bin/env sh
# Local PostgreSQL for development and integration tests (Docker). Not used by the production Compose file.
set -eu
NAME=${NAME:-capacity-console-pg}
PORT=${PORT:-54329}
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -p "127.0.0.1:$PORT:5432" postgres:17-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$NAME" psql -U postgres -c "create database capacity_test;" -c "create database capacity_dev;" >/dev/null
fi
echo "TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:$PORT/capacity_test"
echo "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:$PORT/capacity_dev"
