#!/bin/sh
# Railway startCommand replaces CMD (and sometimes ENTRYPOINT). Always boot
# through the nginx image entrypoint so ${PORT} / ${API_UPSTREAM} are
# substituted and we never start `node dist/index.js`.
set -eu

export PORT="${PORT:-80}"
export API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"

exec /docker-entrypoint.sh nginx -g 'daemon off;'
