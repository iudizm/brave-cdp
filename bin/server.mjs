#!/usr/bin/env node
// Broker started by start.sh. It owns the browser over a CDP *pipe*, so there is no debugging port that
// other local users could connect to, and serves run.mjs on a Unix socket inside the private run dir.
//
// usage: node server.mjs <instance> <profileDir> <browserBin>     env: HEADLESS=1 WINDOW=W,H VIEWPORT=WxH|none
//
// Protocol: one JSON request line per connection, one JSON reply line.
//   {op:'ping'} | {op:'list'} | {op:'close', tab} | {op:'stop'} | {op:'run', tab, code, env, cwd}
//   -> {ok, out?, err?, logs?}
import { chromium } from 'playwright-core';
import fs from 'fs';
import net from 'net';
import { paths, runDirOk, validInstance } from './common.mjs';
import { makeHelpers } from './helpers.mjs';

process.umask(0o077);
const [inst, profile, bin] = process.argv.slice(2);
if (!validInstance(inst) || !profile || !bin || !runDirOk()) { console.error('bad arguments or unsafe run dir'); process.exit(2); }
const { sock, shot } = paths(inst);

// A live socket means this instance already runs; a dead one is left over from a crash.
if (fs.existsSync(sock)) {
  const alive = await new Promise((r) => { const c = net.connect(sock, () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  if (alive) { console.error(`instance ${inst} is already running`); process.exit(1); }
  fs.unlinkSync(sock);
}

const win = /^\d+,\d+$/.test(process.env.WINDOW || '') ? process.env.WINDOW : '1400,1000';
const vp = /^\d+x\d+$/.test(process.env.VIEWPORT || '') ? process.env.VIEWPORT : '1400x1000';
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: bin,
  headless: process.env.HEADLESS === '1',
  chromiumSandbox: true, // Playwright's default is --no-sandbox
  // A fixed desktop viewport keeps responsive sites from switching to mobile layouts.
  viewport: process.env.VIEWPORT === 'none' ? null : { width: +vp.split('x')[0], height: +vp.split('x')[1] },
  args: [`--window-size=${win}`],
  // Stay close to a normal Brave: Shields lists arrive via component updates and background networking,
  // and the security features Playwright turns off for test runs stay on.
  ignoreDefaultArgs: [
    '--disable-component-update', '--disable-background-networking', '--disable-extensions',
    '--disable-component-extensions-with-background-pages', '--disable-default-apps', '--disable-popup-blocking',
    '--disable-client-side-phishing-detection', '--disable-ipc-flooding-protection', '--enable-unsafe-swiftshader',
    '--password-store=basic', '--use-mock-keychain',
  ],
  handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
}).catch((e) => { console.log(`FAILED: ${e.message}`); process.exit(1); }); // start.sh watches for this

// ---------- tabs ----------
const tabs = new Map(); // name -> Page
const queues = new Map(); // name -> tail of that name's queue

/** Runs fn after everything queued under `key` (snippets on one tab never interleave). */
function queued(key, fn) {
  const next = (queues.get(key) || Promise.resolve()).then(fn, fn);
  queues.set(key, next.catch(() => {}));
  return next;
}
/** The page for a tab name; reuses the initial about:blank tab if nothing claimed it yet. */
const getTab = (name) => queued('\0tabs', async () => {
  let p = tabs.get(name);
  if (p && !p.isClosed()) return p;
  const claimed = new Set(tabs.values());
  p = ctx.pages().find((x) => !claimed.has(x) && x.url() === 'about:blank') || await ctx.newPage();
  tabs.set(name, p);
  return p;
});
const nameOf = (p) => [...tabs].find(([, v]) => v === p)?.[0];

// ---------- requests ----------
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const errText = (e) => 'ERR ' + String(e?.message || e).split('\n').slice(0, 6).join('\n');
const show = (x) => { if (typeof x === 'string') return x; try { return JSON.stringify(x, null, 1); } catch { return String(x); } };

async function run({ tab, code, env, cwd }) {
  const page = await getTab(tab);
  return queued(tab, async () => {
    const logs = [];
    const say = (...a) => logs.push(a.map(show).join(' '));
    const con = { log: say, info: say, warn: say, error: say, debug: say };
    const helpers = makeHelpers(page, { shotPath: shot(tab), cwd });
    try {
      const fn = new AsyncFn('page', 'ctx', 'browser', 'env', 'console', ...Object.keys(helpers), code);
      const r = await fn(page, ctx, ctx.browser(), env, con, ...Object.values(helpers));
      return { ok: true, logs, out: r === undefined ? undefined : show(r) };
    } catch (e) { return { ok: false, logs, err: errText(e) }; }
  });
}

async function handle(req) {
  const tabOk = (t) => typeof t === 'string' && t.length > 0 && t.length <= 64;
  switch (req?.op) {
    case 'ping': return { ok: true, out: `${inst}\t${profile}` };
    case 'list': {
      const lines = [];
      for (const p of ctx.pages()) lines.push(`${nameOf(p) || '(unnamed)'}\t${p.url()}\t${await p.title().catch(() => '')}`);
      return { ok: true, out: lines.join('\n') };
    }
    case 'close':
      if (!tabOk(req.tab)) break;
      return queued(req.tab, async () => {
        const p = tabs.get(req.tab); tabs.delete(req.tab);
        if (!p || p.isClosed()) return { ok: true, out: `no tab ${req.tab}` };
        await p.close();
        return { ok: true, out: `closed ${req.tab}` };
      });
    case 'stop': await closeAll(); return { ok: true, out: 'stopped' };
    case 'run':
      if (!tabOk(req.tab) || typeof req.code !== 'string') break;
      return run({ tab: req.tab, code: req.code, env: req.env || {}, cwd: typeof req.cwd === 'string' ? req.cwd : '/' });
  }
  return { ok: false, err: 'ERR bad request' };
}

const server = net.createServer((c) => {
  let buf = '';
  c.setEncoding('utf8');
  c.on('error', () => {});
  c.on('data', (d) => {
    buf += d;
    if (buf.length > 16 << 20) return c.destroy();
    const i = buf.indexOf('\n');
    if (i < 0) return;
    c.removeAllListeners('data');
    let req; try { req = JSON.parse(buf.slice(0, i)); } catch {}
    handle(req)
      .catch((e) => ({ ok: false, err: errText(e) }))
      .then((res) => c.end(JSON.stringify(res) + '\n', () => { if (closing) process.exit(0); }));
  });
});

// ---------- lifecycle ----------
let closing = false;
const dropSock = () => { try { fs.unlinkSync(sock); } catch {} };
/** Closes the browser (flushing the profile) before anything else touches it. */
async function closeAll() {
  closing = true;
  server.close();
  dropSock();
  await ctx.close().catch(() => {});
}
ctx.on('close', () => { if (!closing) { dropSock(); process.exit(0); } }); // window closed by hand or browser crashed
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => closeAll().then(() => process.exit(0)));

server.listen(sock, () => console.log(`ready: ${inst} (profile: ${profile})`));
