# Shared setup for start.sh / stop.sh (sourced; expects $INSTANCE). Mirrors common.mjs.

[ "$(uname -s)" = Linux ] || { echo "brave-cdp supports Linux only" >&2; exit 1; }
[[ "$INSTANCE" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || { echo "invalid instance name: $INSTANCE" >&2; exit 1; }

# Everything lives in a private per-user dir; refuse one that someone else planted in /tmp.
umask 077
RUN_DIR="/tmp/claude-brave-$(id -u)"
mkdir -p "$RUN_DIR"
[ -d "$RUN_DIR" ] && [ ! -L "$RUN_DIR" ] && [ -O "$RUN_DIR" ] || { echo "unsafe $RUN_DIR: not a directory owned by you" >&2; exit 1; }
chmod 700 "$RUN_DIR"
BIN_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_PROFILE="$RUN_DIR/profile-$INSTANCE"  # default, temporary profile (what --clean deletes)
LOG="$RUN_DIR/$INSTANCE.log"
SOCK="$RUN_DIR/$INSTANCE.sock"            # served by server.mjs, the only way to drive the browser

# Talks to this instance's broker (see run.mjs --ping/--stop).
client() { node "$BIN_DIR/run.mjs" --instance "$INSTANCE" "$@"; }
