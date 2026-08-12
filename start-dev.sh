#!/usr/bin/env bash
# Start Git Workspace only. Does not stop other Rust/cargo projects.
set -euo pipefail

export PATH="${HOME}/.local/share/fnm/node-versions/v22.23.2/installation/bin:${HOME}/.cargo/bin:/usr/bin:/bin:${PATH}"
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig:${PKG_CONFIG_PATH:-}"
export DISPLAY="${DISPLAY:-:0}"

# WebKitGTK / NVIDIA blank-window workarounds
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export GDK_BACKEND="${GDK_BACKEND:-x11}"

cd "$(dirname "$0")"

echo "==> Toolchain"
command -v node && node --version
command -v npm && npm --version
command -v cargo && cargo --version
command -v git && git --version

# Free only THIS app's Vite port
if command -v fuser >/dev/null 2>&1; then
  fuser -k 1430/tcp 2>/dev/null || true
fi

# Stop only a previous Git Workspace binary (exact name)
if command -v pkill >/dev/null 2>&1; then
  pkill -x git-workspace 2>/dev/null || true
fi

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

echo "==> cargo check (fast compile smoke)"
if ! cargo check --manifest-path src-tauri/Cargo.toml; then
  echo "cargo check FAILED — fix Rust errors above"
  exit 1
fi

echo "==> Starting tauri dev (log also in tauri-dev-last.log)"
# Keep a log so errors are easy to share
exec npm run tauri:dev 2>&1 | tee tauri-dev-last.log
