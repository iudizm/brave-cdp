#!/usr/bin/env bash
# Stop the isolated browser started by start.sh.
# usage: stop.sh [port] [--clean]   (--clean also deletes the temporary profile)
PORT="${CDP_PORT:-9333}"; CLEAN=0
for a in "$@"; do case "$a" in --clean) CLEAN=1;; *) PORT="$a";; esac; done
PROFILE_DIR="${PROFILE_DIR:-/tmp/claude-brave-$PORT}"
# The pattern is assembled at runtime, so it never matches this script's own command line.
PAT="remote-debugging-port=""$PORT"
pkill -f -- "--$PAT" && echo "stopped browser on :$PORT" || echo "nothing running on :$PORT"
sleep 1
rm -f "/tmp/claude-brave-$PORT-tabs.json"
if [ "$CLEAN" = 1 ] && [[ "$PROFILE_DIR" == /tmp/* ]]; then rm -rf "$PROFILE_DIR" "$PROFILE_DIR.log"; echo "removed $PROFILE_DIR"; fi
