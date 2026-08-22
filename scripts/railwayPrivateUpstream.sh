#!/usr/bin/env bash
# Point one front door's /api proxy at the BFF's private Railway domain.
#
# Every Atmosphere front door (office console, marketing site, staff console)
# serves static files from nginx and reverse-proxies /api to the same BFF.
# Pointing that proxy at the public https host sends the request back out of
# the mesh and in through the edge (jfk1 -> ams1), which 502s /api for a few
# seconds — the "Atmosphere API is not reachable" screen. The private domain
# in api.upstream stays inside the project and answers over plain HTTP.
#
#   scripts/railwayPrivateUpstream.sh Atmosphere-internal
#
# For surfaces this repo does not build. The office and website jobs set the
# same value inline because their own `railway up` follows immediately.
#
# Idempotent on purpose: writing the variable redeploys that service, so the
# value is only written when what is live on it is missing or public. Never
# fails the caller — a service that is absent or unreadable is a warning, not
# a reason to fail a production deploy of the services we do own.
set -u

service="${1:-}"
if [ -z "$service" ]; then
  echo "usage: scripts/railwayPrivateUpstream.sh <railway-service-name>" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
environment="${RAILWAY_ENVIRONMENT:-production}"
upstream="$(tr -d '\n' <"$root/api.upstream")"

warn() {
  echo "::warning::$1"
}

live="$(
  railway variables --service "$service" --environment "$environment" --json 2>/dev/null |
    node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d));
      process.stdin.on("end", () => {
        try {
          const vars = JSON.parse(raw);
          process.stdout.write(String(vars.API_UPSTREAM ?? ""));
        } catch {
          process.stdout.write("");
        }
      });
    ' || true
)"

if [ -z "$live" ]; then
  # Either the service has no API_UPSTREAM yet, or we could not read it (no
  # such service, token without access). Both are worth a line in the log.
  warn "Could not read API_UPSTREAM from Railway service '$service' — it is unset, or the service does not exist in this project. Set it by hand to '$upstream' if that service is live."
fi

# Railway resolves ${{Service.RAILWAY_PRIVATE_DOMAIN}} before handing the value
# to the container, so what comes back here is the resolved host, not the
# template that produced it.
case "$live" in
  http://*.railway.internal:*)
    echo "$service already proxies /api over the private mesh ($live)."
    exit 0
    ;;
esac

echo "Setting API_UPSTREAM on $service to the Atmosphere private domain."
if printf '%s' "$upstream" | railway variable set API_UPSTREAM --stdin --service "$service"; then
  echo "$service now proxies /api to $upstream (Railway redeploys it with the new value)."
else
  warn "Could not set API_UPSTREAM on Railway service '$service'. Set it in the Railway dashboard to '$upstream'."
fi

exit 0
