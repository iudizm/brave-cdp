# Shared setup for start.sh / stop.sh (sourced; expects $INSTANCE). Mirrors common.mjs.

[ "$(uname -s)" = Linux ] || { echo "brave-cdp supports Linux only" >&2; exit 1; }
[[ "$INSTANCE" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || { echo "invalid instance name: $INSTANCE" >&2; exit 1; }

# Everything lives in a private per-user dir; refuse one that someone else planted in /tmp.
umask 077
RUN_DIR="/tmp/claude-brave-$(id -u)"
mkdir -p "$RUN_DIR"
# Refuse rather than repair: if it was ever open to others, they may have planted files in it.
if [ -L "$RUN_DIR" ] || [ ! -d "$RUN_DIR" ] || [ ! -O "$RUN_DIR" ] || (( 8#$(stat -c %a "$RUN_DIR") & 8#077 )); then
  echo "unsafe $RUN_DIR: must be a directory owned by you with mode 0700 (remove it and retry)" >&2; exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_PROFILE="$RUN_DIR/profile-$INSTANCE"  # default, temporary profile (what --clean deletes)
LOG="$RUN_DIR/$INSTANCE.log"
SOCK="$RUN_DIR/$INSTANCE.sock"            # served by server.mjs, the only way to drive the browser

# start.sh and stop.sh for one instance never overlap (fd 9 holds the lock until the script exits).
exec 9>"$RUN_DIR/$INSTANCE.lock"
flock -w 60 9 || { echo "timed out waiting for another start/stop of $INSTANCE" >&2; exit 1; }

# Talks to this instance's broker (see run.mjs --ping/--stop).
client() { node "$SCRIPT_DIR/run.mjs" --instance "$INSTANCE" "$@"; }
