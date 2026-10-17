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
The scripts use `/proc`, `setsid` (util-linux), `ss` (iproute2) and `realpath` (coreutils).
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
- CDP listens on localhost only, but any process running as your user can control the browser while it is open.
  `start.sh` and `run.mjs` only accept an endpoint whose process is provably the browser `start.sh` launched.
- With a persistent `PROFILE_DIR` and logged-in sessions, a malicious page (prompt injection) can lead the agent to act
  as you on those sites. Use a persistent profile only when needed; `start.sh` refuses real browser profiles.
- Temporary profiles, logs and screenshots live in `/tmp/claude-brave-<uid>/` (mode 0700); `stop.sh --clean` removes them.

## License

[MIT](LICENSE)
