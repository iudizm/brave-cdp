#!/usr/bin/env node
// Wall-clock time of common actions, measured the way the agent pays for them: one `node run.mjs` call each.
// usage: node test/bench.mjs [runs=10]   (prints a markdown table; the "real page" rows need network)
// goto and click include settling (see settle in helpers.mjs), as the agent gets them by default.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../scripts/', import.meta.url));
const RUNS = Number(process.argv[2] || 10);
const INSTANCE = `bench-${process.pid}`;

const html = `<!doctype html><title>bench</title><style>h1{color:#c00;font-family:serif}</style>
  <h1>Bench</h1><p>${'Lorem ipsum dolor sit amet. '.repeat(200)}</p><button onclick="this.textContent='ok'">Press me</button>`;
const srv = http.createServer((q, r) => r.end(html));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const LOCAL = `http://127.0.0.1:${srv.address().port}/`;
const REAL = 'https://en.wikipedia.org/wiki/Brave_(web_browser)';

// Async on purpose: the local test server lives in this process and must keep answering.
const sh = promisify(execFile);
const ms = async (f) => { const t = process.hrtime.bigint(); await f(); return Number(process.hrtime.bigint() - t) / 1e6; };
const run = (code) => sh('node', [`${BIN}run.mjs`, '--instance', INSTANCE, '-e', code]);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);

const rows = [];
async function bench(name, code, { before, runs = RUNS } = {}) {
  const xs = [];
  for (let i = 0; i < runs; i++) { if (before) await run(before); xs.push(await ms(() => run(code))); }
  rows.push([name, fmt(median(xs)), fmt(Math.min(...xs))]);
}

try {
  const start = [];
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    start.push(await ms(() => sh(`${BIN}start.sh`, [INSTANCE])));
    if (i < Math.min(RUNS, 3) - 1) await sh(`${BIN}stop.sh`, [INSTANCE, '--clean']);
  }
  rows.push(['`start.sh` (cold browser launch)', fmt(median(start)), fmt(Math.min(...start))]);

  await bench('Empty call (`run.mjs` round trip)', 'return 1');
  await bench('`goto` local page', `await goto('${LOCAL}')`);
  await bench('`goto` real page (Wikipedia article)', `await goto('${REAL}')`, { runs: Math.min(RUNS, 5) });
  await bench('`goto` same page, `wait: 0` (no settling)', `await goto('${REAL}', { wait: 0 })`, { runs: Math.min(RUNS, 5) });
  await bench('`text()` (Wikipedia article, 4000 chars)', 'return text()');
  await bench('`styles()`', 'return styles()');
  await bench('`shot()` viewport', 'return shot()');
  await bench('`shot({ selector })` one element', `return shot(undefined, { selector: '.infobox' })`);
  await bench('`clickables()`', 'return clickables()');
  await run(`await goto('${LOCAL}', { wait: 0 })`);
  await bench('`click` a button', `await click('Press me')`, { before: 'await page.reload()' });
} finally {
  await sh(`${BIN}stop.sh`, [INSTANCE, '--clean']);
  srv.close();
}

console.log(`| Action | Median | Best |\n|---|---|---|`);
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
console.log(`\n${RUNS} runs each (start: ${Math.min(RUNS, 3)}, real page: ${Math.min(RUNS, 5)}).`);
