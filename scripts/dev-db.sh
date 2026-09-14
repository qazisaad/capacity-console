#!/usr/bin/env sh
# Development-only PostgreSQL; never replace an existing container or discard its data.
set -eu
NAME=${NAME:-capacity-console-pg}
PORT=${PORT:-54329}
if docker container inspect "$NAME" >/dev/null 2>&1; then
  docker start "$NAME" >/dev/null
else
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -p "127.0.0.1:$PORT:5432" postgres:17-alpine >/dev/null
fi
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$NAME" pg_isready -U postgres >/dev/null
for database in capacity_test capacity_dev; do
  exists=$(docker exec "$NAME" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$database'")
  if [ "$exists" != "1" ]; then docker exec "$NAME" createdb -U postgres "$database"; fi
done
echo "TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:$PORT/capacity_test"
echo "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:$PORT/capacity_dev"
