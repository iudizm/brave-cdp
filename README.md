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
The scripts use `setsid` (util-linux) and `realpath` (coreutils).
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

- `run.mjs` runs arbitrary JavaScript in Node with your user's permissions (that is the point of the skill).
  Allowlisting `node …/run.mjs` in Claude Code's permissions is the same as allowing arbitrary code execution.
- No CDP port is opened: a broker (`server.mjs`) holds the browser over a pipe and serves `run.mjs` on a Unix socket
  inside `/tmp/claude-brave-<uid>/` (mode 0700), so other local users cannot drive the browser. Chromium's sandbox
  stays on (Playwright would disable it by default).
- With a persistent profile (`PROFILE=name`) and logged-in sessions, a malicious page (prompt injection) can lead the
  agent to act as you on those sites. Use one only when needed. Persistent profiles can only live in
  `~/.local/share/brave-cdp/profiles/`, so the browser can never be pointed at your everyday browser profile.
- Temporary profiles, logs and screenshots live in `/tmp/claude-brave-<uid>/` (mode 0700); `stop.sh --clean` removes them.

## License

[MIT](LICENSE)
