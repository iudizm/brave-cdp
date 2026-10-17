// Helpers available in every snippet (see SKILL.md). Bound to one page per run.
import path from 'path';

/** Loopback, private, link-local (incl. cloud metadata) or unspecified addresses, by literal host name. */
export function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::' || h === '::1' || /^f[cd]|^fe[89ab]/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** @param page Playwright page; shotPath default screenshot file; cwd caller's directory (relative paths). */
export function makeHelpers(page, { shotPath, cwd }) {
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
  async function shot(file = shotPath, { full = false } = {}) {
    const p = path.resolve(cwd, file);
    await page.screenshot({ path: p, fullPage: full });
    return p;
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

  return { sleep, goto, text, shot, clickables, click, waitText, capture, netlog, grepScripts };
}
