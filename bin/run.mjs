#!/usr/bin/env node
// Run a Playwright snippet against the isolated browser started by start.sh.
//
// usage:
//   node run.mjs [--tab NAME] [--port N] <script.js>      run a file
//   node run.mjs [--tab NAME] -e '<code>'                 run inline code
//   node run.mjs [--tab NAME] -                           read code from stdin
//   node run.mjs --list                                   list tabs
//   node run.mjs --close NAME                             close a named tab
//
// The snippet body runs as an async function. In scope: page, ctx, browser, env (process.env)
// and the helpers defined below. Its return value is printed (strings raw, everything else as JSON).
// Named tabs persist between calls, so multi-step flows can be driven one call at a time.
import { chromium } from 'playwright-core';
import fs from 'fs';

const argv = process.argv.slice(2);
const opt = { tab: 'main', port: process.env.CDP_PORT || '9333' };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tab') opt.tab = argv[++i];
  else if (a === '--port') opt.port = argv[++i];
  else if (a === '--list') opt.list = true;
  else if (a === '--close') opt.close = argv[++i];
  else if (a === '-e') opt.code = argv[++i];
  else rest.push(a);
}
if (!/^[1-9]\d{0,4}$/.test(opt.port) || Number(opt.port) > 65535) { console.log(`ERR invalid port: ${opt.port}`); process.exit(2); }

// Private per-user dir created by start.sh (see lib.sh); refuse it if it is not ours or not private.
process.umask(0o077);
const RUN_DIR = `/tmp/claude-brave-${process.getuid()}`;
try {
  const st = fs.lstatSync(RUN_DIR);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw 0;
} catch { console.log(`ERR ${RUN_DIR} missing or unsafe. Run start.sh first.`); process.exit(2); }
const stateFile = `${RUN_DIR}/${opt.port}-tabs.json`;
const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
const saveState = (s) => fs.writeFileSync(stateFile, JSON.stringify(s));

// The endpoint recorded by start.sh is trusted only if that file is ours and its browser is still alive,
// owned by us and launched with the recorded profile and port. Anyone can listen on a localhost port.
function endpoint() {
  try {
    const file = `${RUN_DIR}/${opt.port}.instance`;
    if (fs.statSync(file).uid !== process.getuid()) return null;
    const [profile, pid, ws] = fs.readFileSync(file, 'utf8').split('\n');
    if (!/^\d+$/.test(pid) || fs.statSync(`/proc/${pid}`).uid !== process.getuid()) return null;
    const cmd = ` ${fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')} `; // Chromium may rewrite it space-separated
    return cmd.includes(` --user-data-dir=${profile} `) && cmd.includes(` --remote-debugging-port=${opt.port} `) ? ws : null;
  } catch { return null; }
}
const ws = endpoint();
if (!ws) { console.log(`ERR no browser started by start.sh on :${opt.port}. Run start.sh first.`); process.exit(2); }
let browser;
try {
  browser = await chromium.connectOverCDP(ws);
} catch (e) {
  console.log(`ERR cannot connect to CDP on :${opt.port}. Run start.sh first.`);
  process.exit(2);
}
const ctx = browser.contexts()[0];

async function targetId(p) {
  const s = await ctx.newCDPSession(p);
  try { return (await s.send('Target.getTargetInfo')).targetInfo.targetId; } finally { await s.detach().catch(() => {}); }
}
async function findTab(name) {
  const id = loadState()[name];
  if (!id) return null;
  for (const p of ctx.pages()) { try { if (await targetId(p) === id) return p; } catch {} }
  return null;
}

async function finish(code = 0) {
  await browser.close().catch(() => {}); // connectOverCDP: only disconnects, the browser keeps running
  process.exit(code);
}

if (opt.list) {
  const state = loadState(); const byId = Object.fromEntries(Object.entries(state).map(([k, v]) => [v, k]));
  for (const p of ctx.pages()) {
    const id = await targetId(p).catch(() => '?');
    console.log(`${byId[id] || '(unnamed)'}\t${p.url()}\t${await p.title().catch(() => '')}`);
  }
  await finish();
}
if (opt.close) {
  const p = await findTab(opt.close);
  if (p) await p.close();
  const s = loadState(); delete s[opt.close]; saveState(s);
  console.log(p ? `closed ${opt.close}` : `no tab ${opt.close}`);
  await finish();
}

let page = await findTab(opt.tab);
if (!page) {
  // Reuse the initial about:blank tab if nothing claimed it yet.
  const claimed = new Set(Object.values(loadState()));
  for (const p of ctx.pages()) {
    if (p.url() === 'about:blank' && !claimed.has(await targetId(p).catch(() => ''))) { page = p; break; }
  }
  page = page || await ctx.newPage();
  const s = loadState(); s[opt.tab] = await targetId(page); saveState(s);
}
// A fixed desktop viewport keeps responsive sites from switching to mobile layouts between calls.
if (process.env.VIEWPORT !== 'none') {
  const [w, h] = (process.env.VIEWPORT || '1400x1000').split('x').map(Number);
  await page.setViewportSize({ width: w, height: h }).catch(() => {});
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (s) => s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/** Navigate and give client-side apps time to render. */
async function goto(url, { wait = 3000, until = 'domcontentloaded', timeout = 45000 } = {}) {
  await page.goto(url, { waitUntil: until, timeout });
  if (wait) await sleep(wait);
  return page.url();
}
/** Visible text of the page (or a selector), squashed. Use from/to markers to slice the relevant part. */
async function text({ selector = 'body', max = 4000, from, to, oneLine = false } = {}) {
  let t = await page.locator(selector).first().innerText().catch(() => '');
  if (from) { const i = t.indexOf(from); if (i >= 0) t = t.slice(i); }
  if (to) { const i = t.indexOf(to, 1); if (i >= 0) t = t.slice(0, i); }
  t = squash(t);
  if (oneLine) t = t.replace(/\n/g, ' | ');
  return t.length > max ? t.slice(0, max) + `\n…[${t.length - max} more chars]` : t;
}
/** Screenshot; then use the Read tool on the returned path to look at it. */
async function shot(path = `${RUN_DIR}/${opt.port}-${opt.tab.replace(/[^\w.-]/g, '_')}.png`, { full = false } = {}) {
  await page.screenshot({ path, fullPage: full });
  return path;
}
/** Visible interactive elements with a ready-to-use selector hint. Filter by regex on text/attrs. */
async function clickables(re, { max = 80 } = {}) {
  const rx = re ? new RegExp(re, 'i') : null;
  const items = await page.$$eval(
    'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=option],[role=checkbox],[onclick],[data-test-id],[data-testid],[data-test]',
    (els) => els.filter((e) => e.offsetParent || e.getClientRects().length).map((e) => {
      const tid = e.getAttribute('data-test-id') || e.getAttribute('data-testid') || e.getAttribute('data-test');
      const tidAttr = e.hasAttribute('data-test-id') ? 'data-test-id' : e.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
      const sel = tid ? `[${tidAttr}="${tid}"]` : e.id ? `#${e.id}` : e.name ? `${e.tagName.toLowerCase()}[name="${e.name}"]` : '';
      const label = (e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''} ${sel} :: ${label}`;
    }));
  return [...new Set(items)].filter((x) => !rx || rx.test(x)).slice(0, max).join('\n');
}
/** Click the first visible element matching visible text (string/regex) or a CSS selector (prefix 'css='). */
async function click(target, { wait = 1500 } = {}) {
  const loc = typeof target === 'string' && target.startsWith('css=')
    ? page.locator(target.slice(4))
    : page.getByText(target instanceof RegExp ? target : new RegExp(target, 'i'));
  await loc.locator('visible=true').first().click();
  if (wait) await sleep(wait);
}
/** Wait until the page text matches a regex. */
async function waitText(re, timeout = 30000) {
  const src = re instanceof RegExp ? re.source : re, flags = re instanceof RegExp ? re.flags : 'i';
  await page.waitForFunction(([s, f]) => new RegExp(s, f).test(document.body.innerText), [src, flags], { timeout });
}
/**
 * Run `action` and collect responses whose URL matches `urlRe` (JSON parsed when possible).
 * Great for reading a site's own API instead of scraping the DOM.
 */
async function capture(urlRe, action, { wait = 4000 } = {}) {
  const rx = new RegExp(urlRe, 'i'), out = [];
  const h = async (r) => { if (rx.test(r.url())) { const b = await r.text().catch(() => ''); let j; try { j = JSON.parse(b); } catch {} out.push({ url: r.url(), status: r.status(), body: j ?? b }); } };
  page.on('response', h);
  try { await action(); await sleep(wait); } finally { page.off('response', h); }
  return out;
}
/** Log network requests (excluding static assets) and failures while running `action`. */
async function netlog(action, { wait = 4000, all = false } = {}) {
  const log = [];
  const onRes = (r) => { if (all || !/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|css|ico)(\?|$)/i.test(r.url())) log.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`); };
  const onFail = (r) => log.push(`FAIL ${r.url().slice(0, 160)} ${r.failure()?.errorText}`);
  page.on('response', onRes); page.on('requestfailed', onFail);
  try { await action(); await sleep(wait); } finally { page.off('response', onRes); page.off('requestfailed', onFail); }
  return log.join('\n');
}
/** grep the page's loaded JS bundles for a string (e.g. to discover deep-link/query params). */
async function grepScripts(needle, { ctxChars = 200, max = 10 } = {}) {
  const srcs = await page.$$eval('script[src]', (s) => s.map((x) => x.src));
  const hits = [];
  for (const s of srcs) {
    try {
      const t = await (await page.request.get(s)).text();
      for (let i = t.indexOf(needle); i >= 0 && hits.length < max; i = t.indexOf(needle, i + 1))
        hits.push(`${s.split('/').pop()}: …${t.slice(Math.max(0, i - ctxChars), i + ctxChars)}…`);
    } catch {}
  }
  return hits.join('\n---\n');
}

// ---------- run ----------
let code = opt.code;
if (code == null) {
  const f = rest[0];
  if (!f) { console.log('usage: run.mjs [--tab NAME] <file.js | -e code | ->'); await finish(1); }
  code = f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8');
}
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const helpers = { sleep, goto, text, shot, clickables, click, waitText, capture, netlog, grepScripts };
const fn = new AsyncFn('page', 'ctx', 'browser', 'env', ...Object.keys(helpers), code);
let exit = 0;
try {
  const r = await fn(page, ctx, browser, process.env, ...Object.values(helpers));
  if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
} catch (e) {
  console.log('ERR ' + String(e.message || e).split('\n').slice(0, 6).join('\n'));
  exit = 1;
}
await finish(exit);
