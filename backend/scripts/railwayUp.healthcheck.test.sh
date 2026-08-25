#!/usr/bin/env bash
# Guard the railwayUp.sh healthcheck matcher: intermediate Railway probe
# retries must not count as a finished failure.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# Keep this in lockstep with the grep in railwayUp.sh.
finished_failure() {
  grep -qiE 'Deployment failed|Healthcheck failed|healthcheck failure' "$1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

printf '%s\n' \
  'Starting Healthcheck' \
  'Path: /health' \
  'Attempt #1 failed with service unavailable. Continuing to retry for 49s' \
  'Attempt #2 failed with service unavailable. Continuing to retry for 38s' \
  >"$tmpdir/retrying.log"

if finished_failure "$tmpdir/retrying.log"; then
  echo "retrying probe log must not match a finished failure" >&2
  exit 1
fi

printf '%s\n' \
  'Starting Healthcheck' \
  'Attempt #1 failed with service unavailable. Continuing to retry for 49s' \
  'Deployment failed during network process' \
  >"$tmpdir/failed.log"

if ! finished_failure "$tmpdir/failed.log"; then
  echo "finished Deployment failed log must match" >&2
  exit 1
fi

printf '%s\n' 'Healthcheck failed' >"$tmpdir/probe-failed.log"
if ! finished_failure "$tmpdir/probe-failed.log"; then
  echo "Healthcheck failed log must match" >&2
  exit 1
fi

echo "railwayUp healthcheck matcher ok"
# Touch the script so a rename of railwayUp.sh fails this job if we forget.
test -f "$here/railwayUp.sh"
# Official CLI 5.43+ treats $CI=true as --ci. The upload must unset it
# or GitHub Actions exits after the image push.
grep -q 'env -u CI' "$here/railwayUp.sh"
grep -q -- '--message' "$here/railwayUp.sh"
grep -q -- '--no-gitignore' "$here/railwayUp.sh"
grep -q 'wait_for_deployment' "$here/railwayUp.sh"
extract_deploy_id() {
  grep -oE 'id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$1" \
    | head -1 | cut -d= -f2
}
printf '%s\n' 'Build Logs: https://railway.com/project/x/service/y?id=b3d4930c-1c3d-4ab1-bdc7-dd3e7d6b9be3&' \
  >"$tmpdir/up.log"
[ "$(extract_deploy_id "$tmpdir/up.log")" = 'b3d4930c-1c3d-4ab1-bdc7-dd3e7d6b9be3' ]
echo "railwayUp CI-mode override ok"
