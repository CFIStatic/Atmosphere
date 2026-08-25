#!/usr/bin/env bash
# Guard: Corporate Website deploys must keep the npm Railway CLI wrapper.
#
# Official CLI 5.43+ treats GitHub's CI=true as --ci. The
# cursor/bigger-logo-16cc ships then exited after the Metal image push, so
# the Railway dashboard never showed a finished Corporate Website replica.
# This workflow stays on `npm install -g @railway/cli` until that is fixed
# for this service. Other deploy jobs may use scripts/installRailwayCli.sh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="$root/.github/workflows/deploy-website.yml"

test -f "$workflow"

if ! grep -qE '^[[:space:]]+run: npm install -g @railway/cli$' "$workflow"; then
  echo "$workflow must install the npm Railway CLI wrapper" >&2
  exit 1
fi

if grep -qE 'run:[[:space:]]*bash[[:space:]]+scripts/installRailwayCli\.sh' "$workflow"; then
  echo "$workflow must not install the official Railway CLI binary" >&2
  exit 1
fi

echo "Corporate Website Railway CLI stays on the npm wrapper"
