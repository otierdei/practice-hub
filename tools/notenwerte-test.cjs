// Spielt das Notenwerte Spiel komplett durch (mit absichtlichen Fehlern) und macht Bildschirmfotos
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | '))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8080/notenwerte.html'); await p.fill('#nm', 'Mia'); await p.screenshot({ path: '/tmp/nw-home.png', fullPage: true });
  await p.click('[data-act=level][data-id="1"]');
  const wrong = {}; let guard = 0, shots = 0;
  while (guard++ < 800) {
    if (await p.locator('text=Zur Urkunde').count()) { await p.click('text=Zur Urkunde'); break; }
    if (await p.locator('text=geschafft!').count()) { await p.locator('[data-act=level]').first().click(); continue; }
    const st = await p.evaluate(() => { if (!G) return null; const q = G.q || (G.qs && G.qs[G.i]); if (G.c) return { id: G.id, learn: true, right: G.c.cur ? BY[G.c.cur].beats : '', ans: !!G.c.ans }; return { id: G.id, ri: q ? rightIndex(q) : null, ans: !!(G.ans), kind: q && q.kind }; });
    if (!st) break;
    const ansBtns = await p.locator('[data-act=ans]:not([disabled])').count();
    if (!ansBtns || st.ans) { const nx = p.locator('[data-act=next]'); if (await nx.count()) { await nx.first().click(); continue; } throw new Error('Kein Weiter: ' + JSON.stringify(st)); }
    const doWrong = !wrong[st.id]; wrong[st.id] = true;
    if (st.learn) { const vals = await p.locator('[data-act=ans]').evaluateAll((e) => e.map((x) => x.dataset.v)); const v = doWrong ? vals.find((x) => x !== st.right) : st.right; await p.click(`[data-act=ans][data-v="${v}"]`); }
    else { const n = ansBtns; const i = doWrong ? (st.ri + 1) % n : st.ri; await p.locator('[data-act=ans]').nth(i).click(); }
    if (doWrong && shots++ < 9) await p.screenshot({ path: `/tmp/nw-l${st.id}-${st.kind || 'learn'}.png`, fullPage: true });
  }
  await p.waitForTimeout(200); await p.screenshot({ path: '/tmp/nw-cert.png', fullPage: true });
  assert.match(await p.textContent('body'), /Rhythmusprofi/); assert.match(await p.textContent('body'), /Mia/);
  const prog = await p.evaluate(() => JSON.parse(localStorage.getItem('ph_notenwerte')));
  assert.deepEqual(Object.keys(prog.done).sort(), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(errs, []); console.log('NOTENWERTE DURCHGESPIELT in', guard, 'Schritten, Fehlerpfad je Stufe getestet');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
