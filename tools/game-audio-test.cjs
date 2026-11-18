const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const g of ['notenspiel', 'notenwerte']) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8080/' + g + '.html');
    await p.evaluate(() => { window.__calls = []; for (const k of ['ok', 'bad', 'win']) { const o = GameAudio[k]; GameAudio[k] = () => { window.__calls.push(k); o(); }; } });
    await p.locator('#gaBox [data-ga=music]').waitFor();
    if (await p.locator('#nm').count()) await p.fill('#nm', 'Lena');
    await p.click('[data-act=level][data-id="1"]').catch(() => {});
    // ein paar Antworten durchklicken
    for (let i = 0; i < 25; i++) { const a = p.locator('[data-act=ans]'); if (await a.count()) { await a.first().click(); continue; } const n = p.locator('[data-act=next]'); if (await n.count()) { await n.first().click(); continue; } const t = p.locator('.kit.tap g[data-k]'); if (await t.count()) { await t.first().click({ force: true }); continue; } break; }
    const st = await p.evaluate(() => ({ calls: window.__calls, music: !!GameAudio.pref().music, playing: true }));
    await p.screenshot({ path: '/tmp/shots/ga-' + g + '.png' });
    await p.click('#gaBox [data-ga=music]'); const off = await p.evaluate(() => GameAudio.pref().music);
    console.log(g, JSON.stringify(st.calls.slice(0, 8)), 'musik aus nach Tippen:', !off, 'fehler', errs);
    assert.ok(st.calls.length > 0, 'keine Töne ausgelöst'); assert.equal(off, false); assert.deepEqual(errs, []);
  }
  console.log('GRÜN'); await b.close();
})().catch((e) => { console.error('FEHLER', e.message); process.exit(1); });
