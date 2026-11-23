#!/usr/bin/env sh
set -eu

: "${PORT:=5000}"

exec gunicorn --bind "0.0.0.0:${PORT}" --workers "${GUNICORN_WORKERS:-2}" "hr_production:app"
