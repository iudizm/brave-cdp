#!/usr/bin/env bash
# Start an isolated browser (Brave preferred) with a CDP endpoint.
# usage: start.sh [port]
# env:   BROWSER_BIN=/path/to/chromium-like  PROFILE_DIR=dir  HEADLESS=1  WINDOW=1400,1000
set -euo pipefail
PORT="${1:-${CDP_PORT:-9333}}"
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "invalid port: $PORT" >&2; exit 1; }
PROFILE_DIR="$(realpath -m -- "${PROFILE_DIR:-/tmp/claude-brave-$PORT}")"
WINDOW="${WINDOW:-1400,1000}"

if curl -sf "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
  echo "already running on :$PORT (profile: $PROFILE_DIR)"; exit 0
fi

BIN="${BROWSER_BIN:-}"
if [ -z "$BIN" ]; then
  for c in brave-browser brave brave-browser-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then BIN="$(command -v "$c")"; break; fi
  done
fi
if [ -z "$BIN" ]; then  # fall back to Playwright's bundled Chromium
  BIN="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$BIN" ] || { echo "no Chromium-based browser found; set BROWSER_BIN" >&2; exit 1; }

mkdir -p "$PROFILE_DIR"
ARGS=(--user-data-dir="$PROFILE_DIR" --remote-debugging-port="$PORT" --no-first-run
      --no-default-browser-check --window-size="$WINDOW" --disable-features=Translate)
[ "${HEADLESS:-0}" = "1" ] && ARGS+=(--headless=new)

nohup setsid "$BIN" "${ARGS[@]}" about:blank >"$PROFILE_DIR.log" 2>&1 &

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "started $(basename "$BIN") on :$PORT (profile: $PROFILE_DIR)"; exit 0
  fi
  sleep 0.5
done
echo "browser did not expose CDP on :$PORT; see $PROFILE_DIR.log" >&2; exit 1
