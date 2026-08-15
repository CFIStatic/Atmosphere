#!/usr/bin/env bash
# Publish the running Atmosphere app (main) on an HTTPS URL a phone can open.
#
# Prerequisites: backend on :4000 and the Vite app on :5174
#   (cloud-agent start script, or `npm run dev` in backend/ and frontend/).
#
# Usage:
#   bash scripts/host-phone.sh
#
# Then on the phone:
#   Field Capture  <url>/fieldcapture/
#   Office console <url>/
# iPhone: Safari → Share → Add to Home Screen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ATMOSPHERE_APP_PORT:-5174}"
API_PORT="${PORT_API:-4000}"
BIN_DIR="${ATMOSPHERE_CLOUDFLARED_DIR:-$HOME/.cache/atmosphere}"
LOG="${ATMOSPHERE_PHONE_LOG:-/tmp/atmosphere-phone-tunnel.log}"
URL_FILE="${ATMOSPHERE_PHONE_URL_FILE:-/tmp/atmosphere-phone-url.txt}"
TARGET="http://127.0.0.1:${PORT}"

need() {
  local url="$1" label="$2"
  if curl -sf --max-time 2 "$url" >/dev/null; then
    return 0
  fi
  echo "Atmosphere ${label} is not reachable at ${url}." >&2
  echo "Start the stack first (backend :${API_PORT}, app :${PORT})." >&2
  exit 1
}

need "http://127.0.0.1:${API_PORT}/api/health" "API"
need "${TARGET}/" "app"

mkdir -p "$BIN_DIR"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  linux-x86_64|linux-amd64) ASSET="cloudflared-linux-amd64" ;;
  linux-aarch64|linux-arm64) ASSET="cloudflared-linux-arm64" ;;
  darwin-arm64) ASSET="cloudflared-darwin-arm64.tgz" ;;
  darwin-x86_64) ASSET="cloudflared-darwin-amd64.tgz" ;;
  *)
    echo "No cloudflared build for ${OS}-${ARCH}." >&2
    exit 1
    ;;
esac

CLOUDFLARED="${BIN_DIR}/cloudflared"
if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "Downloading cloudflared…"
  TMP="${BIN_DIR}/cloudflared.download"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}" -o "$TMP"
  if [[ "$ASSET" == *.tgz ]]; then
    tar -xzf "$TMP" -C "$BIN_DIR"
    mv -f "${BIN_DIR}/cloudflared" "$CLOUDFLARED"
    rm -f "$TMP"
  else
    mv -f "$TMP" "$CLOUDFLARED"
  fi
  chmod +x "$CLOUDFLARED"
fi

# Reuse a tunnel that is already advertising a URL.
if [[ -f "$URL_FILE" ]]; then
  existing="$(tr -d '[:space:]' < "$URL_FILE" || true)"
  if [[ "$existing" == https://*.trycloudflare.com ]]; then
    if curl -sf --max-time 5 "$existing/" >/dev/null; then
      echo "$existing"
      echo
      echo "Field Capture  ${existing}/fieldcapture/"
      echo "Office         ${existing}/"
      echo
      echo "On iPhone: open Field Capture in Safari → Share → Add to Home Screen."
      exit 0
    fi
  fi
fi

rm -f "$URL_FILE"
: > "$LOG"

echo "Opening an HTTPS tunnel to ${TARGET}…"
"$CLOUDFLARED" tunnel --no-autoupdate --url "$TARGET" >>"$LOG" 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > /tmp/atmosphere-phone-tunnel.pid

cleanup() {
  if kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM

url=""
for _ in $(seq 1 60); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "cloudflared exited before it printed a URL." >&2
    tail -n 40 "$LOG" >&2 || true
    exit 1
  fi
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -n 1 || true)"
  if [[ -n "$url" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$url" ]]; then
  echo "Timed out waiting for a trycloudflare.com URL." >&2
  tail -n 40 "$LOG" >&2 || true
  exit 1
fi

printf '%s\n' "$url" > "$URL_FILE"

echo "$url"
echo
echo "Field Capture  ${url}/fieldcapture/"
echo "Office         ${url}/"
echo
echo "On iPhone: open Field Capture in Safari → Share → Add to Home Screen."
echo "Tunnel log: ${LOG}  (pid ${TUNNEL_PID})"
echo
echo "Leave this running. Ctrl+C stops the public URL."

if [[ "${ATMOSPHERE_PHONE_WAIT:-1}" == "1" ]]; then
  wait "$TUNNEL_PID"
fi
