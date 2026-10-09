#!/usr/bin/env bash
# Guard: dockerBuildRetry.sh retries a transient registry failure, passes a
# real build failure straight through (no retry), and forwards exit codes
# faithfully. Uses a fake `docker` on PATH so it needs no real daemon.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/scripts/dockerBuildRetry.sh"

test -f "$script"
test -x "$script"

bindir="$(mktemp -d)"
countfile="$(mktemp)"
trap 'rm -rf "$bindir" "$countfile"' EXIT

# Fake docker: behaviour chosen by $FAKE_DOCKER_MODE, call count in $COUNTFILE.
cat >"$bindir/docker" <<'FAKE'
#!/usr/bin/env bash
n=$(( $(cat "$COUNTFILE") + 1 ))
echo "$n" > "$COUNTFILE"
case "$FAKE_DOCKER_MODE" in
  ok) echo "built ok"; exit 0 ;;
  transient) echo "ERROR: toomanyrequests: You have reached your unauthenticated pull rate limit." >&2; exit 1 ;;
  real) echo "ERROR: COPY failed: no such file or directory" >&2; exit 1 ;;
  flaky-then-ok)
    if [ "$n" -lt 2 ]; then
      echo "ERROR: failed to resolve source metadata for docker.io/library/node:22-bookworm-slim: 504 Gateway Timeout" >&2
      exit 1
    fi
    echo "built ok on retry"; exit 0 ;;
esac
FAKE
chmod +x "$bindir/docker"

run() { # mode expected_rc expected_calls
  : > "$countfile"
  local rc=0
  PATH="$bindir:$PATH" COUNTFILE="$countfile" FAKE_DOCKER_MODE="$1" \
    DOCKER_BUILD_ATTEMPTS=3 DOCKER_BUILD_RETRY_DELAY=0 \
    bash "$script" -f Dockerfile -t x:ci . >/dev/null 2>&1 || rc=$?
  local calls; calls="$(cat "$countfile")"
  if [ "$rc" != "$2" ]; then echo "mode=$1 expected rc $2, got $rc" >&2; exit 1; fi
  if [ "$calls" != "$3" ]; then echo "mode=$1 expected $3 docker calls, got $calls" >&2; exit 1; fi
  echo "ok: mode=$1 rc=$rc calls=$calls"
}

run ok 0 1             # success on first try, no retry
run transient 1 3      # transient error retried up to the attempt cap, then fails
run real 1 1           # real build error fails fast, never retried
run flaky-then-ok 0 2  # one transient failure, then success

echo "dockerBuildRetry ok"
