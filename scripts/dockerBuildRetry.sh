#!/usr/bin/env bash
# Retry `docker build` when the base-image pull fails on a transient registry
# error. Shared GitHub runners share one Docker Hub pull quota, so an
# unauthenticated pull of a base image (node:22-bookworm-slim, nginx:…) is
# throttled in bursts — `toomanyrequests`, or a 5xx / timeout from
# auth.docker.io — and succeeds on a later try. A non-transient failure (a real
# Dockerfile or build error) is NOT retried: it fails on the first attempt so a
# broken build is still caught fast. All arguments are forwarded to
# `docker build`.
#
# Tunable via env: DOCKER_BUILD_ATTEMPTS (default 4),
# DOCKER_BUILD_RETRY_DELAY (first backoff seconds, default 10; tripled each try).
set -uo pipefail

attempts="${DOCKER_BUILD_ATTEMPTS:-4}"
delay="${DOCKER_BUILD_RETRY_DELAY:-10}"

# Signatures of a transient registry/network failure, not a build error.
transient='toomanyrequests|rate limit|failed to resolve source metadata|failed to (fetch|authorize) oauth token|auth\.docker\.io|registry-1\.docker\.io|TLS handshake timeout|i/o timeout|Gateway Time-?out|Service Unavailable|error code: 50[0-9]|context deadline exceeded|connection reset|EOF|temporary failure'

rc=0
for attempt in $(seq 1 "$attempts"); do
  log="$(mktemp)"
  docker build "$@" 2>&1 | tee "$log"
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ]; then
    rm -f "$log"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ] && grep -Eqi "$transient" "$log"; then
    echo "::warning::docker build hit a transient registry error (attempt ${attempt}/${attempts}); retrying in ${delay}s" >&2
    rm -f "$log"
    sleep "$delay"
    delay=$((delay * 3))
    continue
  fi
  rm -f "$log"
  exit "$rc"
done
exit "$rc"
