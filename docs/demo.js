// Regenerates docs/demo.gif: scripts/start.sh demo && OUT=$PWD/docs/demo.gif node scripts/run.mjs --instance demo docs/demo.js
await page.setViewportSize({ width: 1280, height: 800 });
return await record(env.OUT, async () => {
  await goto('https://en.wikipedia.org/wiki/Special:Search', { wait: 800 });
  await page.screencast.showChapter('brave-cdp', { description: 'Claude Code driving an isolated Brave', duration: 2200 });
  const box = page.getByPlaceholder('Search Wikipedia').first();
  await box.click(); await box.pressSequentially('Brave (web browser)', { delay: 70 });
  await box.press('Enter');
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await click(/^History$/); await sleep(1200);
  const t = await text({ selector: '#mw-content-text p:not(.mw-empty-elt)', max: 220, oneLine: true });
  await page.screencast.showOverlay(`<div style="position:absolute;bottom:40px;left:40px;right:40px;padding:18px 22px;background:#111d;color:#eee;font:15px/1.5 monospace;border-radius:10px">text() →<br>${t.replace(/</g,'&lt;')}</div>`, { duration: 3500 });
  await sleep(3600);
}, { maxIdle: 2 });
