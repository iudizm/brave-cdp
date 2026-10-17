#!/usr/bin/env bash
# Start an isolated browser (Brave preferred), driven by server.mjs over a CDP pipe (no TCP port).
# usage: start.sh [instance]   (default: "default")
# env:   BROWSER_BIN=/path/to/chromium-like  PROFILE=name  HEADLESS=1  WINDOW=1400,1000  VIEWPORT=1400x1000|none
set -euo pipefail
INSTANCE="${1:-default}"
. "$(dirname "$0")/lib.sh"
# Persistent profiles are only ever named directories under a root this skill owns, so no caller-supplied
# path can point the browser at the user's everyday profile (or at any other existing directory).
PROFILE_ROOT=
if [ -n "${PROFILE:-}" ]; then
  [[ "$PROFILE" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || { echo "invalid profile name: $PROFILE" >&2; exit 1; }
  HOME_DIR="$(getent passwd "$(id -u)" | cut -d: -f6)"  # not $HOME, which the caller controls
  PROFILE_ROOT="$HOME_DIR/.local/share/brave-cdp/profiles"
  PROFILE_DIR="$PROFILE_ROOT/$PROFILE"
else
  PROFILE_DIR="$TMP_PROFILE"
fi

# Report the profile the running instance actually uses, which may differ from this call's env.
if PING="$(client --ping 2>/dev/null)"; then
  RUNNING="${PING#*$'\t'}"
  if [ -z "${PROFILE:-}" ] || [ "$RUNNING" = "$PROFILE_DIR" ]; then
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

# Every directory we hand to the browser must be a real directory owned by us and closed to others.
mkdir -p "$PROFILE_DIR"
for d in $PROFILE_ROOT "$PROFILE_DIR"; do
  if [ -L "$d" ] || [ ! -O "$d" ] || (( 8#$(stat -c %a "$d") & 8#077 )); then
    echo "unsafe profile dir $d: must be a non-symlink directory owned by you with mode 0700" >&2; exit 1
  fi
done
# The broker keeps the browser on a pipe and serves run.mjs on $SOCK; it exits when the browser does.
nohup setsid node "$BIN_DIR/server.mjs" "$INSTANCE" "$PROFILE_DIR" "$BIN" 9>&- >"$LOG" 2>&1 &  # not holding the lock

for _ in $(seq 1 60); do
  if client --ping >/dev/null 2>&1; then
    echo "started $(basename "$BIN"): $INSTANCE (profile: $PROFILE_DIR)"; exit 0
  fi
  grep -q '^FAILED' "$LOG" 2>/dev/null && break
  sleep 0.5
done
echo "browser did not start; see $LOG" >&2; exit 1
