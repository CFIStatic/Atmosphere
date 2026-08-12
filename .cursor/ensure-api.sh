#!/usr/bin/env bash
# Idempotently ensure the Atmosphere API is listening on :4000.
#
# Used by:
#   - .cursor/environment.json `start` (background, then exit when healthy)
#   - the "backend" cloud-agent terminal (`--foreground`)
#
# Why this exists: opening the Vite app without the API makes every /api/*
# call look like "Request failed (500)" from the proxy. That must not be the
# default cloud-agent experience.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${ATMOSPHERE_API_LOG:-/tmp/atmosphere-api.log}"
PID_FILE="${ATMOSPHERE_API_PID:-/tmp/atmosphere-api.pid}"
PORT="${PORT:-4000}"
HEALTH="http://127.0.0.1:${PORT}/api/health"
MODE="${1:---background}"

healthy() {
  curl -sf --max-time 2 "$HEALTH" >/dev/null 2>&1
}

port_bound() {
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -qE ":${PORT}\\s"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

wait_healthy() {
  local i
  for i in $(seq 1 90); do
    if healthy; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_background() {
  if healthy; then
    echo "[ensure-api] already healthy on :${PORT}"
    return 0
  fi

  if port_bound; then
    echo "[ensure-api] :${PORT} is bound but not healthy yet — waiting…"
    if wait_healthy; then
      echo "[ensure-api] ready on :${PORT}"
      return 0
    fi
    echo "[ensure-api] :${PORT} stayed unhealthy" >&2
    tail -n 80 "$LOG" 2>/dev/null >&2 || true
    exit 1
  fi

  echo "[ensure-api] starting backend on :${PORT}"
  mkdir -p "$(dirname "$LOG")"
  (
    cd "$ROOT/backend"
    # Keep watch mode so agent edits hot-reload without a second supervisor.
    nohup npm run dev >>"$LOG" 2>&1 &
    echo $! >"$PID_FILE"
  )

  if wait_healthy; then
    echo "[ensure-api] ready on :${PORT}"
    return 0
  fi

  echo "[ensure-api] failed to become healthy on :${PORT}" >&2
  tail -n 80 "$LOG" 2>/dev/null >&2 || true
  exit 1
}

follow_log() {
  touch "$LOG"
  echo "[ensure-api] API up on :${PORT} — following ${LOG}"
  exec tail -n 80 -F "$LOG"
}

case "$MODE" in
  --foreground)
    if healthy || port_bound; then
      wait_healthy || true
      follow_log
    fi
    cd "$ROOT/backend"
    exec npm run dev
    ;;
  --background|*)
    start_background
    ;;
esac
