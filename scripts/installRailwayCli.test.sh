#!/usr/bin/env bash
# Guard: deploy workflows must install the pinned official Railway CLI,
# not the npm wrapper that still depends on deprecated tar@6.x.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/scripts/installRailwayCli.sh"
pin="5.43.3"

test -f "$script"
test -x "$script"
grep -q "RAILWAY_CLI_VERSION:-${pin}" "$script"

for workflow in \
  "$root/.github/workflows/deploy-production.yml" \
  "$root/.github/workflows/deploy-website.yml" \
  "$root/.github/workflows/repair-field-capture-config.yml"
do
  if grep -q 'npm install -g @railway/cli' "$workflow"; then
    echo "$workflow still installs the npm Railway CLI wrapper" >&2
    exit 1
  fi
  grep -q 'scripts/installRailwayCli.sh' "$workflow"
done

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
RAILWAY_CLI_DEST="$tmpdir/railway" "$script"
installed="$("$tmpdir/railway" --version)"
echo "$installed"
printf '%s' "$installed" | grep -q "$pin"

echo "installRailwayCli workflow pin ok"
