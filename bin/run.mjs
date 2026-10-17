#!/usr/bin/env node
// Run a Playwright snippet in the isolated browser started by start.sh.
//
// usage:
//   node run.mjs [--instance NAME] [--tab NAME] <script.js>     run a file
//   node run.mjs [--instance NAME] [--tab NAME] -e '<code>'     run inline code
//   node run.mjs [--instance NAME] [--tab NAME] -               read code from stdin
//   node run.mjs [--instance NAME] --list                       list tabs
//   node run.mjs [--instance NAME] --close NAME                 close a named tab
//   node run.mjs [--instance NAME] --ping | --stop              used by start.sh / stop.sh
//
// The snippet body runs as an async function inside the broker (server.mjs) that owns the browser.
// In scope: page, ctx, browser, env (this process's env), console (captured) and the helpers in
// helpers.mjs. Its return value is printed (strings raw, everything else as JSON).
// Named tabs persist between calls, so multi-step flows can be driven one call at a time.
import fs from 'fs';
import net from 'net';
import { paths, runDirOk, validInstance } from './common.mjs';

const argv = process.argv.slice(2);
const opt = { tab: 'main', instance: 'default' };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length) { console.log(`ERR ${a} needs a value`); process.exit(2); } return argv[++i]; };
  if (a === '--tab') opt.tab = val();
  else if (a === '--instance') opt.instance = val();
  else if (a === '--list') opt.op = 'list';
  else if (a === '--close') { opt.op = 'close'; opt.tab = val(); }
  else if (a === '--ping') opt.op = 'ping';
  else if (a === '--stop') opt.op = 'stop';
  else if (a === '-e') opt.code = val();
  else rest.push(a);
}
if (!validInstance(opt.instance)) { console.log(`ERR invalid instance name: ${opt.instance}`); process.exit(2); }

let req;
if (opt.op) req = { op: opt.op, tab: opt.tab };
else {
  let code = opt.code;
  if (code == null) {
    const f = rest[0];
    if (!f) { console.log('usage: run.mjs [--instance NAME] [--tab NAME] <file.js | -e code | ->'); process.exit(1); }
    code = f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8');
  }
  req = { op: 'run', tab: opt.tab, code, env: process.env, cwd: process.cwd() };
}

/** One request/reply over the broker's socket; null if nothing is listening. */
function send(msg) {
  return new Promise((resolve) => {
    const c = net.connect(paths(opt.instance).sock);
    let buf = '';
    c.setEncoding('utf8');
    c.on('connect', () => c.write(JSON.stringify(msg) + '\n'));
    c.on('data', (d) => { buf += d; });
    c.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, err: 'ERR broker closed the connection' }); } });
    c.on('error', () => resolve(null));
  });
}

const res = runDirOk() ? await send(req) : null;
if (!res) { console.log(`ERR no browser running for instance ${opt.instance}. Run start.sh first.`); process.exit(2); }
for (const l of res.logs || []) console.log(l);
if (res.ok) { if (res.out !== undefined) console.log(res.out); }
else console.log(res.err);
process.exit(res.ok ? 0 : 1);
