#!/usr/bin/env bash
# Upload the current directory to a Railway service and wait until the
# replica is live. `--ci` exits after ~8 minutes while the Metal builder is
# still queued, which is what produced "Deployment failed to build" with no
# Docker layers. Wait for the full deploy instead, and retry a stuck builder.
# RAILWAY_SERVICE selects the target (Atmosphere, Atmosphere-web, website, …).
#
# `railway up --ci` also exits immediately with "Deploys have been paused due
# to an upstream issue" (see https://status.railway.com/incident/VVL3A03V).
# Treat that as retryable instead of failing the GitHub job on the first pause.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
service="${RAILWAY_SERVICE:-Atmosphere APIs}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
max_attempts="${RAILWAY_UP_ATTEMPTS:-8}"
wait_secs="${RAILWAY_UP_TIMEOUT:-900}"
# Stamp retries only — watch-path skip after GitHub Autodeploy already shipped
# this SHA must not burn 8×15min and email red.
max_skip_retries="${RAILWAY_UP_SKIP_RETRIES:-2}"
# deploy-website.yml historically exported RAILWAY_UP_ATTEMPTS=8. Cap the
# corporate-site stamp path at 3 once skip-as-success is in place (OAuth
# tokens without `workflow` scope cannot rewrite the Actions YAML).
if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ] && [[ "${RAILWAY_UP_STAMP_FILE}" == *"/website/.railway-up-stamp" || "${RAILWAY_UP_STAMP_FILE}" == "website/.railway-up-stamp" ]]; then
  if [ -z "${RAILWAY_UP_ATTEMPTS_UNCAP:-}" ] && [ "$max_attempts" -gt 3 ]; then
    echo "Capping website railway up attempts at 3 (workflow had ${max_attempts}; set RAILWAY_UP_ATTEMPTS_UNCAP=1 to keep it)."
    max_attempts=3
  fi
fi

case "$service" in
  Atmosphere) service="Atmosphere APIs" ;;
  Atmosphere-internal) service="Internal Growth Metrics" ;;
  Atmosphere-web) service="Platform" ;;
  website) service="Corporate Website" ;;
  fieldcapture|field-capture|Atmosphere-fieldcapture) service="Field Capture" ;;
esac

if resolved="$(node "$here/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Deploying Railway service=$service project=$project environment=$environment"

railway status --project "$project" --environment "$environment" || true

dump_build_logs() {
  echo "---- railway build logs (latest) ----"
  railway logs --build --latest --lines 300 \
    --project "$project" --environment "$environment" --service "$service" \
    || true
}

# True when a recent SUCCESS deployment already carries the current git SHA
# (typical after GitHub Autodeploy raced this CLI `railway up`).
service_already_deployed_for_head() {
  local head_sha short_sha json
  head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  [ -n "$head_sha" ] || return 1
  short_sha="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
  json="$(
    railway deployment list --json --limit 30 \
      --service "$service" --environment "$environment" 2>/dev/null \
      || true
  )"
  [ -n "$json" ] || return 1
  printf '%s' "$json" | node -e '
    const fs = require("fs");
    const head = process.argv[1];
    const short = process.argv[2] || "";
    let data;
    try {
      data = JSON.parse(fs.readFileSync(0, "utf8"));
    } catch {
      process.exit(1);
    }
    if (!Array.isArray(data)) process.exit(1);
    for (const d of data) {
      const status = String(d.status || "").toUpperCase();
      if (status !== "SUCCESS") continue;
      const meta = d.meta && typeof d.meta === "object" ? d.meta : {};
      const hash = String(
        meta.commitHash || meta.commitSha || meta.commit || ""
      ).trim();
      if (!hash) continue;
      if (
        hash === head ||
        (short && (hash.startsWith(short) || head.startsWith(hash)))
      ) {
        process.exit(0);
      }
    }
    process.exit(1);
  ' "$head_sha" "$short_sha"
}

attempt=1
skip_retries=0
while [ "$attempt" -le "$max_attempts" ]; do
  if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ] && [ -f "${RAILWAY_UP_STAMP_FILE}" ]; then
    printf '\n# railway-up-retry %s %s\n' "$attempt" "$(date -u +%s)" >> "$RAILWAY_UP_STAMP_FILE"
  fi
  echo "railway up attempt $attempt/$max_attempts (wait ${wait_secs}s)"
  log="$(mktemp)"
  timeout "$wait_secs" railway up \
    --service "$service" \
    --project "$project" \
    --environment "$environment" \
    --verbose >"$log" 2>&1
  status=$?
  cat "$log"
  # Railway logs "Attempt #N failed with service unavailable. Continuing to
  # retry" while the probe window is still open. That is normal startup, not
  # a finished failure — treating it as fatal aborted healthy website deploys
  # and the next attempt then hit "no changes in watch paths" and was marked
  # success. Only a completed failed deploy is fatal.
  if grep -qiE 'Deployment failed|Healthcheck failed|healthcheck failure' "$log"; then
    echo "railway up reached a failed healthcheck."
    status=1
  fi
  if [ "$status" -eq 0 ]; then
    if grep -qi 'no changes detected in watch paths' "$log"; then
      if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ]; then
        if service_already_deployed_for_head; then
          echo "Watch paths unchanged, but $service already has a SUCCESS deploy for $(git rev-parse --short HEAD 2>/dev/null || echo HEAD). Treating as success (autodeploy race / idempotent)."
          rm -f "$log"
          exit 0
        fi
        if [ "$skip_retries" -ge "$max_skip_retries" ]; then
          echo "Watch paths still unchanged after ${skip_retries} stamp retries; content already matches watch paths. Treating as success (idempotent deploy)."
          rm -f "$log"
          exit 0
        fi
        skip_retries=$((skip_retries + 1))
        echo "railway up skipped the image build (watch paths). Retrying with a new stamp ($skip_retries/$max_skip_retries)."
        status=1
      else
        echo "railway up skipped the image build (watch paths); no stamp file, treating as success."
      fi
    fi
  fi
  if [ "$status" -eq 0 ]; then
    rm -f "$log"
    echo "Railway deploy succeeded"
    exit 0
  fi
  echo "railway up exited $status"
  if grep -qi 'paused due to an upstream issue' "$log"; then
    echo "Railway paused deploys (https://status.railway.com/incident/VVL3A03V). Retrying."
    sleep $((attempt * 60))
  else
    dump_build_logs
    sleep $((attempt * 30))
  fi
  rm -f "$log"
  if [ "$attempt" -eq "$max_attempts" ]; then
    exit 1
  fi
  attempt=$((attempt + 1))
done

exit 1
