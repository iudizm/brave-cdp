#!/usr/bin/env bash
# Stop the isolated browser started by start.sh.
# usage: stop.sh [port] [--clean]   (--clean also deletes the temporary profile)
PORT="${CDP_PORT:-9333}"; CLEAN=0
for a in "$@"; do case "$a" in --clean) CLEAN=1;; *) PORT="$a";; esac; done
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
rm -f "$STATE" "$TABS"
# Only ever delete the temporary profile; a PROFILE_DIR chosen by the user is never touched.
if [ "$CLEAN" = 1 ]; then rm -rf "$TMP_PROFILE" "$LOG" "$RUN_DIR/$PORT"-*.png; echo "removed $TMP_PROFILE"; fi
