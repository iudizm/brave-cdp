# brave-cdp

**English** | [Português (Brasil)](README.pt-BR.md)

A Claude Code skill that drives an **isolated Brave browser** (its own temporary profile, CDP + Playwright) for any web task, without touching your everyday browser.

Instructions for the agent: [`SKILL.md`](SKILL.md).

## Installation

```bash
git clone https://github.com/iudizm/brave-cdp.git ~/.claude/skills/brave-cdp
cd ~/.claude/skills/brave-cdp && npm ci
```

To clone it somewhere else, symlink it instead: `ln -s "$PWD" ~/.claude/skills/brave-cdp` (from inside the clone).
`SKILL.md` calls the scripts through `~/.claude/skills/brave-cdp/bin`, so the skill must be reachable at that path.

Requires **Linux**, Node 20+ and Brave (or Chromium / Playwright's Chromium as a fallback).
The scripts use `setsid` and `flock` (util-linux) and `realpath` (coreutils); recording GIF/MP4/WebM demos needs `ffmpeg`.
Browsers installed via **snap** don't work (they get a private `/tmp`) and are skipped; use Brave's
.deb/.rpm package or Playwright's Chromium (`npx playwright-core install chromium` in the skill folder).

## Quick start

```bash
B=~/.claude/skills/brave-cdp/bin
$B/start.sh
node $B/run.mjs -e 'await goto("https://example.com"); return text({max: 1500})'
$B/stop.sh --clean
```

## Security

brave-cdp is meant for **supervised** use: you watch the session and approve what the agent does through Claude Code's
normal permission prompts. It removes the easy ways to escape that supervision, but cannot make an agent that reads
untrusted web pages safe on its own.

- `run.mjs` runs arbitrary JavaScript in Node with your user's permissions (that is the point of the skill), and
  `start.sh` runs whatever `BROWSER_BIN` points to. Allowlisting either in Claude Code's permissions is the same as
  allowing arbitrary code execution: approve those calls one by one, or allowlist them only in sandboxes you can throw away.
- Pages can contain prompt injection. `SKILL.md` tells the agent to treat page content as data, never as instructions,
  but that is a mitigation, not a guarantee: watch for actions you didn't ask for.
- No CDP port is opened: a broker (`server.mjs`) holds the browser over a pipe and serves `run.mjs` on a Unix socket
  inside `/tmp/claude-brave-<uid>/` (mode 0700), so other local users cannot drive the browser. Chromium's sandbox
  stays on (Playwright would disable it by default).
- With a persistent profile (`PROFILE=name`) and logged-in sessions, the agent acts as you on those sites. Use one
  only when needed. Persistent profiles can only live in `~/.local/share/brave-cdp/profiles/`, so the browser can
  never be pointed at your everyday browser profile.
- Like any browser, it can reach `localhost` and your local network. `grepScripts()` skips scripts on private hosts
  unless the page itself is local.
- Temporary profiles, logs, screenshots and the socket live in `/tmp/claude-brave-<uid>/`; `stop.sh --clean` removes them.

## License

[MIT](LICENSE)
