#!/usr/bin/env bash
# One command, whole product: builds the dashboard, then serves the corporate
# site, the dashboard app, and the API together on http://localhost:4000 —
# sign in on the website and land in the app (see website/README.md,
# "Single-origin hosting").
#
#   ./start.sh
#
# Requires Node.js 20+. First run installs dependencies and takes a few
# minutes; later runs are fast. Stop with Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Building the dashboard app (frontend/) ..."
(cd frontend && npm install --no-audit --no-fund && npm run build)

echo "==> Starting the server (backend/) ..."
echo "    Open http://localhost:4000 when it says the port is listening."
cd backend && npm install --no-audit --no-fund && exec npm run dev
