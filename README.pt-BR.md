# brave-cdp

[English](README.md) | **Português (Brasil)**

Skill do Claude Code para controlar um **Brave isolado** (perfil temporário próprio, CDP + Playwright) em qualquer tarefa web, sem tocar no navegador do dia a dia.

Instruções de uso para o agente: [`SKILL.md`](SKILL.md).

## Instalação

```bash
git clone https://github.com/iudizm/brave-cdp.git ~/.claude/skills/brave-cdp
cd ~/.claude/skills/brave-cdp && npm ci
```

Se preferir clonar em outro lugar, crie um symlink: `ln -s "$PWD" ~/.claude/skills/brave-cdp` (de dentro do clone).
O `SKILL.md` chama os scripts por `~/.claude/skills/brave-cdp/bin`, então a skill precisa estar acessível nesse caminho.

Requer **Linux**, Node 20+ e Brave (ou Chromium / Chromium do Playwright como fallback).
Os scripts usam `/proc`, `setsid` (util-linux), `ss` (iproute2) e `realpath` (coreutils).
Navegadores instalados via **snap** não funcionam (têm `/tmp` privado) e são ignorados; use o pacote
.deb/.rpm do Brave ou o Chromium do Playwright (`npx playwright-core install chromium` na pasta da skill).

## Uso rápido

```bash
B=~/.claude/skills/brave-cdp/bin
$B/start.sh
node $B/run.mjs -e 'await goto("https://example.com"); return text({max: 1500})'
$B/stop.sh --clean
```

## Segurança

- `run.mjs` executa JavaScript arbitrário em Node com as permissões do seu usuário (é o propósito da skill).
  Liberar `node …/run.mjs` no allowlist de permissões do Claude Code equivale a liberar execução arbitrária de código.
- A CDP escuta só em localhost, mas qualquer processo do seu usuário pode controlar o navegador enquanto ele estiver aberto.
  `start.sh` e `run.mjs` só aceitam um endpoint cujo processo seja comprovadamente o navegador que o `start.sh` lançou.
- Com `PROFILE_DIR` persistente e sessões logadas, uma página maliciosa (prompt injection) pode induzir o agente a agir
  como você nesses sites. Use perfil persistente só quando precisar; o `start.sh` recusa os perfis reais dos navegadores.
- Perfis temporários, logs e screenshots ficam em `/tmp/claude-brave-<uid>/` (modo 0700); `stop.sh --clean` os remove.

## Licença

[MIT](LICENSE)
