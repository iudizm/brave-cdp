#!/usr/bin/env bash
# Start an isolated browser (Brave preferred), driven by server.mjs over a CDP pipe (no TCP port).
# usage: start.sh [instance]   (default: "default")
# env:   BROWSER_BIN=/path/to/chromium-like  PROFILE_DIR=dir  HEADLESS=1  WINDOW=1400,1000  VIEWPORT=1400x1000|none
set -euo pipefail
INSTANCE="${1:-default}"
. "$(dirname "$0")/lib.sh"
PROFILE_SET="${PROFILE_DIR:+1}"
PROFILE_DIR="$(realpath -m -- "${PROFILE_DIR:-$TMP_PROFILE}")"
# Never drive the user's everyday browser profile (logged-in sessions, saved passwords).
H="$(realpath -m -- "$HOME")"
case "$PROFILE_DIR/" in
  "$H"/.config/BraveSoftware/*|"$H"/.config/google-chrome*/*|"$H"/.config/chromium/*|"$H"/.config/microsoft-edge*/*|\
  "$H"/.config/vivaldi*/*|"$H"/.config/opera*/*|"$H"/snap/brave/*|"$H"/snap/chromium/*|"$H"/.var/app/*)
    echo "refusing to use a real browser profile: $PROFILE_DIR" >&2; exit 1;;
esac

# Report the profile the running instance actually uses, which may differ from this call's env.
if PING="$(client --ping 2>/dev/null)"; then
  RUNNING="${PING#*$'\t'}"
  if [ -z "$PROFILE_SET" ] || [ "$RUNNING" = "$PROFILE_DIR" ]; then
    echo "already running: $INSTANCE (profile: $RUNNING)"; exit 0
  fi
  echo "instance $INSTANCE already runs with profile $RUNNING, not $PROFILE_DIR; run stop.sh $INSTANCE first or pick another instance name" >&2; exit 1
fi

# Snap browsers get a private /tmp, so we could neither see nor clean their profile.
is_snap() { case "$(realpath -- "$1")" in /snap/*) return 0;; esac; grep -qa /snap/ < <(head -c 4096 -- "$1"); }

BIN="${BROWSER_BIN:-}"
if [ -n "$BIN" ] && is_snap "$BIN"; then echo "snap browsers are not supported (private /tmp): $BIN" >&2; exit 1; fi
if [ -z "$BIN" ]; then
  for c in brave-browser brave brave-browser-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 && ! is_snap "$(command -v "$c")"; then BIN="$(command -v "$c")"; break; fi
  done
fi
if [ -z "$BIN" ]; then  # fall back to Playwright's bundled Chromium
  BIN="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$BIN" ] || { echo "no (non-snap) Chromium-based browser found; set BROWSER_BIN or run: npx playwright-core install chromium" >&2; exit 1; }

mkdir -p "$PROFILE_DIR"
[ -O "$PROFILE_DIR" ] || { echo "profile $PROFILE_DIR is not owned by you" >&2; exit 1; }
# The broker keeps the browser on a pipe and serves run.mjs on $SOCK; it exits when the browser does.
nohup setsid node "$BIN_DIR/server.mjs" "$INSTANCE" "$PROFILE_DIR" "$BIN" >"$LOG" 2>&1 &

for _ in $(seq 1 60); do
  if client --ping >/dev/null 2>&1; then
    echo "started $(basename "$BIN"): $INSTANCE (profile: $PROFILE_DIR)"; exit 0
  fi
  grep -q '^FAILED' "$LOG" 2>/dev/null && break
  sleep 0.5
done
echo "browser did not start; see $LOG" >&2; exit 1
