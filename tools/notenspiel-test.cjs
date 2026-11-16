// Spielt das Notenspiel komplett durch (mit absichtlichen Fehlern) und macht Bildschirmfotos
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8080/notenspiel.html'); await p.fill('#nm', 'Lena');
  await p.screenshot({ path: '/tmp/ns-home.png', fullPage: true });
  await p.click('[data-act=level][data-id="1"]');
  let shots = 0, wrongDone = {}, guard = 0;
  const state = () => p.evaluate(() => G ? { id: G.id, cur: G.cur || (G.check && G.check.cur) || (G.seq && G.seq[G.pos]), qtype: G.qtype, answered: !!(G.answered || (G.check && G.check.answered) || G.miss), done: !G.act || false } : null);
  while (guard++ < 600) {
    const st = await state(); if (!st) break;
    const hasNext = await p.locator('[data-act=next], [data-act=certNow]').count();
    if (await p.locator('text=Zur Urkunde').count()) { await p.click('text=Zur Urkunde'); break; }
    if (await p.locator('[data-act=level]').count() && await p.locator('text=geschafft!').count()) { await p.screenshot({ path: '/tmp/ns-done.png' }); await p.locator('[data-act=level]').first().click(); continue; }
    if (hasNext && !(await p.locator('[data-act=ans], .kit.tap g[data-k]').count() && st.id !== 1 && !st.answered)) { await p.locator('[data-act=next]').first().click(); continue; }
    if (st.id === 1 && hasNext && !(await p.locator('[data-act=ans]').count())) { await p.locator('[data-act=next]').first().click(); continue; }
    const wrong = !wrongDone[st.id] && st.id >= 1 && (await p.locator('[data-act=ans], .kit.tap g[data-k]').count()) > 0;
    let target = st.cur;
    if (wrong) { const all = await p.locator('[data-act=ans]').evaluateAll((els) => els.map((e) => e.dataset.k)); const taps = await p.locator('.kit.tap g[data-k]').evaluateAll((els) => els.map((e) => e.dataset.k)); target = (all.length ? all : taps).find((k) => k !== st.cur); wrongDone[st.id] = true; }
    if (await p.locator(`[data-act=ans][data-k="${target}"]`).count()) await p.click(`[data-act=ans][data-k="${target}"]`);
    else if (await p.locator(`.kit.tap g[data-k="${target}"]`).count()) await p.locator(`.kit.tap g[data-k="${target}"]`).dispatchEvent('click');
    else { await p.screenshot({ path: '/tmp/ns-stuck.png', fullPage: true }); throw new Error('Kein Ziel für ' + JSON.stringify(st)); }
    await p.waitForTimeout(st.id === 6 ? 700 : 30);
    if (wrong && shots < 8) await p.screenshot({ path: `/tmp/ns-l${st.id}-${st.qtype || 'x'}.png`, fullPage: true }), shots++;
  }
  await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/ns-cert.png', fullPage: true });
  assert.match(await p.textContent('body'), /Notenprofi/); assert.match(await p.textContent('body'), /Lena/);
  const prog = await p.evaluate(() => JSON.parse(localStorage.getItem('ph_notenspiel')));
  assert.deepEqual(Object.keys(prog.done).sort(), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(errs, []); console.log('NOTENSPIEL DURCHGESPIELT in', guard, 'Schritten, Fehlerpfad je Stufe getestet');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
