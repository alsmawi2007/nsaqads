#!/usr/bin/env bash
# start-dev.sh — bring up the full Nsaq development environment
# Run from the repo root: bash scripts/start-dev.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Starting Postgres + Redis..."
docker compose up -d

echo "▶ Waiting for Postgres to accept connections..."
until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done
echo "  ✔ Postgres ready"

echo "▶ Running database migrations..."
(cd "$ROOT/apps/api" && npx prisma migrate dev --name init 2>&1 | tail -5)

echo "▶ Seeding demo data..."
(cd "$ROOT/apps/api" && npx prisma db seed)

echo ""
echo "▶ Starting API (http://localhost:3000)..."
(cd "$ROOT/apps/api" && npm run dev) &
API_PID=$!

echo "▶ Starting Web (http://localhost:3001)..."
(cd "$ROOT/apps/web" && npm run dev -- --port 3001) &
WEB_PID=$!

echo ""
echo "──────────────────────────────────────────────"
echo "  API:     http://localhost:3000/api/docs"
echo "  Web:     http://localhost:3001"
echo "  Login:   admin@nsaq.io / Password123!"
echo "──────────────────────────────────────────────"
echo ""
echo "Press Ctrl+C to stop all services."
trap "kill $API_PID $WEB_PID 2>/dev/null; docker compose stop; exit" INT TERM
wait
