#!/usr/bin/env bash
# Start an isolated browser (Brave preferred) with a CDP endpoint.
# usage: start.sh [port]
# env:   BROWSER_BIN=/path/to/chromium-like  PROFILE_DIR=dir  HEADLESS=1  WINDOW=1400,1000
set -euo pipefail
PORT="${1:-${CDP_PORT:-9333}}"
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "invalid port: $PORT" >&2; exit 1; }
PROFILE_DIR="$(realpath -m -- "${PROFILE_DIR:-/tmp/claude-brave-$PORT}")"
WINDOW="${WINDOW:-1400,1000}"
. "$(dirname "$0")/lib.sh"
LOG="$PROFILE_DIR.log"

if read_state && [ "$S_PROFILE" = "$PROFILE_DIR" ]; then
  echo "already running on :$PORT (profile: $PROFILE_DIR)"; exit 0
fi
# Anything answering on the port is not proof it is our browser (it could be the user's own browser,
# or another local user's process), so refuse to share the port instead of attaching to it.
if ss -ltnH "sport = :$PORT" | grep -q .; then
  echo "port $PORT is in use by another process (not a browser started by this skill); pick another port" >&2; exit 1
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

nohup setsid "$BIN" "${ARGS[@]}" about:blank >"$LOG" 2>&1 &

# Trust only what our own browser reports: the pid in its profile lock and the endpoint it logged.
# (If 127.0.0.1:PORT is taken meanwhile, Chromium silently binds [::1] instead, so never assume the address.)
for _ in $(seq 1 30); do
  PID="$(lock_pid "$PROFILE_DIR" || true)"
  WS="$(grep -oE "ws://(127\.0\.0\.1|\[::1\]):$PORT/devtools/browser/[0-9a-f-]+" "$LOG" 2>/dev/null | tail -1 || true)"
  if [ -n "$WS" ] && is_ours "$PID" "$PROFILE_DIR"; then
    printf '%s\n' "$PROFILE_DIR" "$PID" "$WS" >"$STATE"
    echo "started $(basename "$BIN") on :$PORT (profile: $PROFILE_DIR)"; exit 0
  fi
  sleep 0.5
done
PID="$(lock_pid "$PROFILE_DIR" || true)"
if is_ours "$PID" "$PROFILE_DIR"; then kill "$PID"; fi
echo "browser did not expose CDP on :$PORT; see $LOG" >&2; exit 1
