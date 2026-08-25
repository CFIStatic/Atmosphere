#!/usr/bin/env bash
# Install the official Railway CLI binary.
#
# Deploy jobs used to run `npm install -g @railway/cli`. That npm wrapper
# still depends on deprecated tar@6.x and prints "Old versions of tar are not
# supported" on every ship. The GitHub release is the same CLI without that
# Node package tree.
#
# Override the pin with RAILWAY_CLI_VERSION. Override the install path with
# RAILWAY_CLI_DEST (defaults to /usr/local/bin/railway, or ~/.local/bin when
# that directory is not writable and sudo is unavailable).
set -euo pipefail

version="${RAILWAY_CLI_VERSION:-5.43.3}"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) target="x86_64-unknown-linux-musl" ;;
  aarch64|arm64) target="aarch64-unknown-linux-musl" ;;
  *)
    echo "Unsupported architecture for Railway CLI: $arch" >&2
    exit 1
    ;;
esac

url="https://github.com/railwayapp/cli/releases/download/v${version}/railway-v${version}-${target}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Installing Railway CLI v${version} (${target})"
curl -fsSL --retry 4 --retry-delay 2 "$url" -o "$tmp/railway.tgz"
tar -xzf "$tmp/railway.tgz" -C "$tmp"
test -x "$tmp/railway"

dest="${RAILWAY_CLI_DEST:-/usr/local/bin/railway}"
dest_dir="$(dirname "$dest")"
mkdir -p "$dest_dir" 2>/dev/null || true
if [ -w "$dest_dir" ]; then
  install -m 0755 "$tmp/railway" "$dest"
elif command -v sudo >/dev/null 2>&1; then
  sudo mkdir -p "$dest_dir"
  sudo install -m 0755 "$tmp/railway" "$dest"
else
  dest="$HOME/.local/bin/railway"
  dest_dir="$(dirname "$dest")"
  mkdir -p "$dest_dir"
  install -m 0755 "$tmp/railway" "$dest"
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$dest_dir" >> "$GITHUB_PATH"
  fi
  export PATH="$dest_dir:$PATH"
fi

# Prefer the just-installed binary over anything else on PATH.
if [ -x "$dest" ]; then
  "$dest" --version
else
  railway --version
fi
