# Shared helpers for start.sh / stop.sh (sourced; expects $PORT).

# What start.sh launched on $PORT: profile dir, browser pid, CDP websocket endpoint (one per line).
STATE="/tmp/claude-brave-$PORT.instance"

# Browser pid that Chromium records in the profile's SingletonLock symlink ("<host>-<pid>").
lock_pid() { local l; l="$(readlink -- "$1/SingletonLock" 2>/dev/null)" || return 1; echo "${l##*-}"; }

# True if <pid> is alive, owned by us, and is a browser launched with <profile> on $PORT.
# (Chromium rewrites its process title, so cmdline may be space- rather than NUL-separated.)
is_ours() {
  local pid="$1" profile="$2" cmd
  [[ "$pid" =~ ^[0-9]+$ ]] && [ -O "/proc/$pid" ] || return 1
  cmd=" $(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null) " || return 1
  [[ "$cmd" == *" --user-data-dir=$profile "* && "$cmd" == *" --remote-debugging-port=$PORT "* ]]
}

# Loads $STATE into S_PROFILE/S_PID/S_WS; succeeds only if the file is ours and its browser still runs.
read_state() {
  [ -f "$STATE" ] && [ -O "$STATE" ] || return 1
  { read -r S_PROFILE; read -r S_PID; read -r S_WS; } <"$STATE" || return 1
  is_ours "$S_PID" "$S_PROFILE"
}
