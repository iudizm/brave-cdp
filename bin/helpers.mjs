// Helpers available in every snippet (see SKILL.md). Bound to one page per run.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

// Recordings outlive a single run (the broker keeps the page), so their state lives at module level.
const recordings = new WeakMap(); // page -> { dir, frames: [[file, ms]], actions, t0 }

/** ffmpeg arguments per output format; frames come from a concat list with per-frame durations. */
const ENCODE = {
  '.mp4': (fps, w) => ['-vf', `fps=${fps || 30},scale='min(${w || 1400},iw)':-2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-movflags', '+faststart'],
  '.webm': (fps, w) => ['-vf', `fps=${fps || 30},scale='min(${w || 1400},iw)':-2:flags=lanczos`, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0'],
  '.gif': (fps, w) => ['-vf', `fps=${fps || 12},scale='min(${w || 900},iw)':-1:flags=lanczos,split[a][b];`
    + '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'],
};

/** Loopback, private, link-local (incl. cloud metadata) or unspecified addresses, by literal host name. */
export function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::' || h === '::1' || /^f[cd]|^fe[89ab]/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * @param page Playwright page; shotPath default screenshot file (videos default to the same name, .mp4);
 * cwd caller's directory (relative paths); tmpPrefix prefix for temporary recording dirs.
 */
export function makeHelpers(page, { shotPath, cwd, tmpPrefix }) {
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
  async function shot(file = shotPath, { full = false, selector } = {}) {
    const p = path.resolve(cwd, file);
    // A single element (logo, header, button) gives the model a smaller, sharper image than the whole page.
    if (selector) await page.locator(selector).first().screenshot({ path: p });
    else await page.screenshot({ path: p, fullPage: full });
    return p;
  }
  /**
   * Visual identity in a few lines: palette and fonts by frequency, then the distinct text styles in use.
   * Exact values are cheaper and more reliable than reading colors off a screenshot.
   */
  async function styles(selector = 'body, h1, h2, h3, h4, p, a, button, input, label, li, nav, header, footer', { max = 25 } = {}) {
    return page.$$eval(selector, (els, max) => {
      const hex = (c) => {
        const m = c.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
        if (!m) return c;
        const h = '#' + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, '0')).join('');
        return m[4] === undefined || m[4] === '1' ? h : `${h}/${m[4]}`;
      };
      const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
      const count = (m, k) => m.set(k, (m.get(k) || 0) + 1);
      const colors = new Map(), fonts = new Map(), kinds = new Map();
      for (const e of els) {
        if (!e.getClientRects().length) continue;
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden') continue;
        const font = s.fontFamily.split(',')[0].trim().replace(/^"|"$/g, '');
        count(colors, hex(s.color));
        if (!clear(s.backgroundColor)) count(colors, hex(s.backgroundColor));
        if (s.borderTopStyle !== 'none' && s.borderTopWidth !== '0px') count(colors, hex(s.borderTopColor));
        count(fonts, font);
        count(kinds, `${e.tagName.toLowerCase()} ${font} ${s.fontSize}/${s.fontWeight} ${hex(s.color)}`
          + (clear(s.backgroundColor) ? '' : ` on ${hex(s.backgroundColor)}`)
          + (s.borderRadius !== '0px' ? ` radius ${s.borderRadius}` : ''));
      }
      const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ×${v}`);
      return [`palette: ${top(colors, 12).join(', ')}`, `fonts: ${top(fonts, 6).join(', ')}`, 'styles:', ...top(kinds, max)].join('\n');
    }, max);
  }
  /** Visible interactive elements with a ready-to-use selector hint. Filter by regex on text/attrs. */
  async function clickables(re, { max = 80 } = {}) {
    const rx = re ? new RegExp(re, 'i') : null;
    const items = await page.$$eval(
      'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=option],[role=checkbox],[onclick],[data-test-id],[data-testid],[data-test]',
      (els) => els.filter((e) => e.offsetParent || e.getClientRects().length).map((e) => {
        const tidAttr = ['data-test-id', 'data-testid', 'data-test'].find((a) => e.getAttribute(a));
        const id = e.getAttribute('id'), name = e.getAttribute('name'); // not e.id/e.name: forms can shadow those
        const sel = tidAttr ? `[${tidAttr}="${CSS.escape(e.getAttribute(tidAttr))}"]` : id ? `#${CSS.escape(id)}`
          : name ? `${e.tagName.toLowerCase()}[name="${CSS.escape(name)}"]` : '';
        const label = (e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''} ${sel} :: ${label}`;
      }));
    return [...new Set(items)].filter((x) => !rx || rx.test(x)).slice(0, max).join('\n');
  }
  /** Click the first visible element matching visible text (string/regex) or a CSS selector (prefix 'css='). */
  async function click(target, { wait = 1500 } = {}) {
    const loc = typeof target === 'string' && target.startsWith('css=')
      ? page.locator(target.slice(4))
      : page.getByText(target instanceof RegExp ? target : new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
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
  async function capture(urlRe, action, { wait = 4000, max = 50, maxBody = 200000 } = {}) {
    const rx = new RegExp(urlRe, 'i'), out = [];
    const h = async (r) => {
      if (!rx.test(r.url()) || out.length >= max) return;
      let b = await r.text().catch(() => '');
      if (b.length > maxBody) b = b.slice(0, maxBody) + `…[${b.length - maxBody} more chars]`; // huge bodies stay out of memory and context
      let j; try { j = JSON.parse(b); } catch {}
      out.push({ url: r.url(), status: r.status(), body: j ?? b });
    };
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
  async function grepScripts(needle, { ctxChars = 200, max = 10, maxScripts = 40, maxBytes = 5e6 } = {}) {
    // page.request reads responses outside the page's CORS rules, so a hostile page must not be able to point it
    // at local/intranet services; those are fetched only when the page itself is local (testing a local app).
    const local = isPrivateHost(new URL(page.url()).hostname || 'localhost');
    const srcs = (await page.$$eval('script[src]', (s) => s.map((x) => x.src)))
      .filter((s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) && (local || !isPrivateHost(u.hostname)); } catch { return false; } })
      .slice(0, maxScripts);
    const hits = [];
    for (const s of srcs) {
      if (hits.length >= max) break;
      try {
        const res = await page.request.get(s, { timeout: 15000 });
        if (Number(res.headers()['content-length'] || 0) > maxBytes) continue;
        const t = (await res.text()).slice(0, maxBytes);
        for (let i = t.indexOf(needle); i >= 0 && hits.length < max; i = t.indexOf(needle, i + 1))
          hits.push(`${s.split('/').pop()}: …${t.slice(Math.max(0, i - ctxChars), i + ctxChars)}…`);
      } catch {}
    }
    return hits.join('\n---\n');
  }

  /**
   * Start recording this tab (frames are only captured when the page repaints). With `actions`, clicks and
   * fills show an animated cursor and a highlight. Recording survives across run.mjs calls until recStop().
   */
  async function recStart({ actions = true, maxSeconds = 300, quality = 80 } = {}) {
    if (recordings.has(page)) throw new Error('already recording this tab; call recStop(path) first');
    await page.screencast.stop().catch(() => {}); // a screencast left over from a failed run
    const rec = { dir: fs.mkdtempSync(tmpPrefix), frames: [], t0: Date.now() };
    await page.screencast.start({
      size: page.viewportSize() || { width: 1400, height: 1000 }, quality,
      onFrame: ({ data, timestamp }) => {
        if (timestamp - rec.t0 > maxSeconds * 1000) return;
        const f = `${rec.dir}/${String(rec.frames.length).padStart(6, '0')}.jpg`;
        fs.writeFileSync(f, data);
        rec.frames.push([f, timestamp]);
      },
    });
    if (actions) rec.actions = await page.screencast.showActions();
    recordings.set(page, rec);
    return 'recording';
  }
  /**
   * Stop recording and encode by extension: .mp4 (default), .gif or .webm. Needs ffmpeg. A still frame lasts at
   * most `maxIdle` seconds, so the time spent between run.mjs calls doesn't turn into long frozen stretches.
   */
  async function recStop(file = shotPath.replace(/\.png$/, '.mp4'), { fps, width, maxIdle = 2 } = {}) {
    const rec = recordings.get(page);
    if (!rec) throw new Error('not recording this tab; call recStart() first');
    recordings.delete(page);
    const end = Date.now();
    try {
      await page.screencast.stop();
      await rec.actions?.dispose().catch(() => {});
      const out = path.resolve(cwd, file), ext = path.extname(out).toLowerCase();
      if (!ENCODE[ext]) throw new Error(`unsupported format ${ext}; use .mp4, .gif or .webm`);
      if (!rec.frames.length) throw new Error('no frames captured');
      // Each frame lasts until the next one; the last one until recStop (concat needs it listed twice).
      const { frames } = rec, list = `${rec.dir}/list.txt`;
      const dur = (i) => Math.min(maxIdle, ((i + 1 < frames.length ? frames[i + 1][1] : end) - frames[i][1]) / 1000);
      fs.writeFileSync(list, frames.map(([f], i) => `file '${f}'\nduration ${Math.max(dur(i), 0.001).toFixed(3)}`).join('\n')
        + `\nfile '${frames.at(-1)[0]}'\n`);
      await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...ENCODE[ext](fps, width), out])
        .catch((e) => { throw new Error(e.code === 'ENOENT' ? 'recording needs ffmpeg (e.g. apt install ffmpeg)' : e.stderr || e.message); });
      const total = frames.reduce((s, _, i) => s + Math.max(dur(i), 0.001), 0);
      return `${out} (${total.toFixed(1)}s, ${Math.round(fs.statSync(out).size / 1024)} kB)`;
    } finally {
      fs.rmSync(rec.dir, { recursive: true, force: true });
    }
  }
  /** Record `action` into `file` (format by extension). On error the recording is discarded. */
  async function record(file, action, opts = {}) {
    await recStart(opts);
    try { await action(); } catch (e) {
      const rec = recordings.get(page);
      recordings.delete(page);
      await page.screencast.stop().catch(() => {});
      await rec?.actions?.dispose().catch(() => {});
      if (rec) fs.rmSync(rec.dir, { recursive: true, force: true });
      throw e;
    }
    return recStop(file, opts);
  }

  return { sleep, goto, text, shot, styles, clickables, click, waitText, capture, netlog, grepScripts, recStart, recStop, record };
}
