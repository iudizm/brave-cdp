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
Os scripts usam `setsid` e `flock` (util-linux) e `realpath` (coreutils); gravar demos em GIF/MP4/WebM requer `ffmpeg`.
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

O brave-cdp é feito para uso **supervisionado**: você acompanha a sessão e aprova o que o agente faz pelos prompts de
permissão normais do Claude Code. Ele fecha os caminhos fáceis para escapar dessa supervisão, mas não consegue, sozinho,
tornar seguro um agente que lê páginas web não confiáveis.

- `run.mjs` executa JavaScript arbitrário em Node com as permissões do seu usuário (é o propósito da skill), e o
  `start.sh` executa o que `BROWSER_BIN` apontar. Liberar qualquer um dos dois no allowlist do Claude Code equivale a
  liberar execução arbitrária de código: aprove essas chamadas uma a uma, ou libere só em sandboxes descartáveis.
- Páginas podem conter prompt injection. O `SKILL.md` instrui o agente a tratar o conteúdo das páginas como dado, nunca
  como instrução, mas isso é mitigação, não garantia: fique de olho em ações que você não pediu.
- Nenhuma porta CDP é aberta: um broker (`server.mjs`) segura o navegador via pipe e atende o `run.mjs` num socket Unix
  dentro de `/tmp/claude-brave-<uid>/` (modo 0700), então outros usuários locais não conseguem controlar o navegador.
  O sandbox do Chromium continua ligado (o Playwright o desligaria por padrão).
- Com perfil persistente (`PROFILE=nome`) e sessões logadas, o agente age como você nesses sites. Use só quando
  precisar. Perfis persistentes só podem ficar em `~/.local/share/brave-cdp/profiles/`, então o navegador nunca pode
  ser apontado para o perfil do seu navegador do dia a dia.
- Como qualquer navegador, ele alcança `localhost` e a sua rede local. O `grepScripts()` ignora scripts em hosts
  privados, a menos que a própria página seja local.
- Perfis temporários, logs, screenshots e o socket ficam em `/tmp/claude-brave-<uid>/`; `stop.sh --clean` os remove.

## Licença

[MIT](LICENSE)
