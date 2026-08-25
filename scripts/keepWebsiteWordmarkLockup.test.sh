#!/usr/bin/env bash
# Guard: marketing wordmark bars stay the same size as the company name,
# and both stay at nav scale (not the 24px / 36px lockup).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
css="$root/website/assets/site.css"

test -f "$css"

awk '
  $0 ~ /^\.wordmark \{/ { in_wm=1 }
  in_wm && $0 ~ /font-size: 15px/ { font=1 }
  in_wm && $0 ~ /^\}/ { in_wm=0 }
  $0 ~ /^\.wordmark svg/ { in_svg=1 }
  in_svg && $0 ~ /width: 1em/ && $0 ~ /height: 1em/ { mark=1 }
  in_svg && $0 ~ /\{/ { next }
  in_svg && $0 ~ /\}/ { in_svg=0 }
  END {
    if (!font) { print "wordmark must be 15px to match the nav" > "/dev/stderr"; exit 1 }
    if (!mark) { print "wordmark bars must be 1em so they match the company name" > "/dev/stderr"; exit 1 }
  }
' "$css"

if grep -R --include='*.html' -q 'site.css?v=20260825-logo2' "$root/website"; then
  echo "marketing pages still pin the oversized logo cache stamp" >&2
  exit 1
fi

echo "Corporate Website wordmark lockup stays proportionate"
