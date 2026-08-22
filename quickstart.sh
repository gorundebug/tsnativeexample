#!/usr/bin/env bash
set -euo pipefail

for command in docker; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: ${command}" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required" >&2
  exit 1
fi

echo "==> Building independent TypeScript native service images"
docker compose build
echo "==> Starting Redpanda, Inventory, Order and Analytics"
docker compose up --detach
echo "==> Started. Use 'make docker-down' to stop the example."
