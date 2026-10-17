#!/usr/bin/env bash
# Stop the isolated browser started by start.sh.
# usage: stop.sh [instance] [--clean]   (--clean also deletes the temporary profile, log and screenshots)
INSTANCE=default; CLEAN=0
for a in "$@"; do case "$a" in --clean) CLEAN=1;; *) INSTANCE="$a";; esac; done
. "$(dirname "$0")/lib.sh"
# The broker closes the browser (flushing the profile) before it replies, so cleaning up afterwards is safe.
if client --stop >/dev/null 2>&1; then echo "stopped $INSTANCE"; else echo "nothing running for $INSTANCE"; fi
# Only ever delete the temporary profile; a PROFILE_DIR chosen by the user is never touched.
if [ "$CLEAN" = 1 ]; then rm -rf "$TMP_PROFILE" "$LOG" "$RUN_DIR/$INSTANCE"-*.{png,mp4,gif,webm} "$RUN_DIR/$INSTANCE"-rec-* "$RUN_DIR/$INSTANCE.lock"; echo "removed $TMP_PROFILE"; fi
