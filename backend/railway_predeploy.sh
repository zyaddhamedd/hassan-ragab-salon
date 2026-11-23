#!/usr/bin/env sh
set -eu

echo "[RAILWAY PREDEPLOY] Running database migrations..."
flask --app hr_production db upgrade head

if [ -n "${INITIAL_ADMIN_EMAIL:-}" ] && [ -n "${INITIAL_ADMIN_PASSWORD:-}" ]; then
  echo "[RAILWAY PREDEPLOY] Running initial production bootstrap..."
  flask --app hr_production init-production-data
else
  echo "[RAILWAY PREDEPLOY] INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD not set. Skipping automatic bootstrap."
fi
