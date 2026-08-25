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
echo "railwayUp CI-mode override ok"
