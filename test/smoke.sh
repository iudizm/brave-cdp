#!/usr/bin/env bash
# End-to-end smoke test: starts a throwaway instance, drives a local page and cleans up.
# usage: test/smoke.sh   (needs a browser like start.sh does; the recording check also needs ffmpeg)
set -u
BIN="$(cd "$(dirname "$0")/../scripts" && pwd)"
INSTANCE="smoke-$$"
RUN_DIR="/tmp/claude-brave-$(id -u)"
FAILS=0; SRV=
run() { node "$BIN/run.mjs" --instance "$INSTANCE" "$@"; }
check() { # check <name> <expected regex> <command...>
  local name="$1" re="$2"; shift 2
  local out; out="$("$@" 2>&1)"
  if grep -Eq -- "$re" <<<"$out"; then echo "ok   $name"; else echo "FAIL $name"; sed 's/^/     /' <<<"$out"; FAILS=$((FAILS + 1)); fi
}
cleanup() {
  "$BIN/stop.sh" "$INSTANCE" --clean >/dev/null 2>&1
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null
}
trap cleanup EXIT

# A local page, so the test needs no network.
PORT_FILE="$(mktemp)"
node -e '
  const html = `<!doctype html><title>smoke</title><style>h1{color:#c00;font-family:serif}</style>
    <h1>SMOKE-MARKER</h1><button data-x="clicked" onclick="this.textContent=this.dataset.x">Press me</button>`;
  const s = require("http").createServer((q, r) => r.end(html)).listen(0, "127.0.0.1", () =>
    require("fs").writeFileSync(process.argv[1], String(s.address().port)));
' "$PORT_FILE" &
SRV=$!
for _ in $(seq 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
URL="http://127.0.0.1:$(cat "$PORT_FILE")/"; rm -f "$PORT_FILE"

check "start"            "^started"                  "$BIN/start.sh" "$INSTANCE"
check "ping"             "pong|ok"                   run --ping
check "goto + text"      "SMOKE-MARKER"              run -e "await goto('$URL', {wait: 200}); return text()"
check "click"            "clicked"                   run -e "await click('Press me', {wait: 200}); return text()"
check "styles"           "#cc0000"                   run -e "return styles('h1')"
check "shot"             "\.png [1-9]"               run -e "const p = await shot(); return p + ' ' + (await import('node:fs')).statSync(p).size"
check "console capture"  "hello from console"        run -e "console.log('hello from console')"
check "snippet error"    "ERR|Error"                 run -e "throw new Error('boom')"
check "second tab"       "SMOKE-MARKER"              run --tab other -e "await goto('$URL', {wait: 200}); return text()"
check "list tabs"        "other"                     run --list
check "close tab"        "."                         run --close other
if command -v ffmpeg >/dev/null; then
  check "record gif"     "\.gif \("                  run -e "return record('$RUN_DIR/$INSTANCE-main.gif', () => sleep(500))"
else
  echo "skip record gif (no ffmpeg)"
fi
check "no TCP listener"  "^none$"                    bash -c "pids=\$(pgrep -d '|' -f 'profile-$INSTANCE|server.mjs $INSTANCE '); ss -ltnp | grep -E \"pid=(\$pids),\" || echo none"
check "stop"             "^stopped"                  "$BIN/stop.sh" "$INSTANCE" --clean
check "gone after stop"  "no browser running"        run --ping

echo; if [ "$FAILS" = 0 ]; then echo "all passed"; else echo "$FAILS failed"; exit 1; fi
