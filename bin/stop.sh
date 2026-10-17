#!/usr/bin/env bash
# Stop the isolated browser started by start.sh.
# usage: stop.sh [port] [--clean]   (--clean also deletes the temporary profile)
PORT="${CDP_PORT:-9333}"; CLEAN=0
for a in "$@"; do case "$a" in --clean) CLEAN=1;; *) PORT="$a";; esac; done
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "invalid port: $PORT" >&2; exit 1; }
PROFILE_DIR="$(realpath -m -- "${PROFILE_DIR:-/tmp/claude-brave-$PORT}")"
. "$(dirname "$0")/lib.sh"
# Kill only the exact browser start.sh recorded (verified pid), never processes matched by a pattern.
if read_state; then
  kill "$S_PID"
  for _ in $(seq 1 20); do kill -0 "$S_PID" 2>/dev/null || break; sleep 0.25; done  # let it flush the profile
  kill -0 "$S_PID" 2>/dev/null && kill -9 "$S_PID"
  echo "stopped browser on :$PORT"
else
  echo "nothing running on :$PORT"
fi
rm -f "$STATE" "/tmp/claude-brave-$PORT-tabs.json"
# Only ever delete temporary profiles created by start.sh (path is canonical, so no `..` tricks).
if [ "$CLEAN" = 1 ]; then
  if [[ "$PROFILE_DIR" == /tmp/claude-brave-* ]]; then rm -rf "$PROFILE_DIR" "$PROFILE_DIR.log"; echo "removed $PROFILE_DIR"
  else echo "not removing $PROFILE_DIR (not a temporary profile)"; fi
fi
