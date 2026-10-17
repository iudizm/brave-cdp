# brave-cdp

Skill do Claude Code para controlar um **Brave isolado** (perfil temporário próprio, CDP + Playwright) em qualquer tarefa web, sem tocar no navegador do dia a dia.

Instruções de uso para o agente: [`SKILL.md`](SKILL.md).

## Instalação

```bash
git clone https://github.com/iudizm/brave-cdp.git ~/code/iudi/brave-cdp
cd ~/code/iudi/brave-cdp && npm install
ln -s ~/code/iudi/brave-cdp ~/.claude/skills/brave-cdp
```

Requer Node 18+ e Brave (ou Chromium / Chromium do Playwright como fallback).

## Uso rápido

```bash
B=~/.claude/skills/brave-cdp/bin
$B/start.sh
node $B/run.mjs -e 'await goto("https://example.com"); return text({max: 1500})'
$B/stop.sh --clean
```
