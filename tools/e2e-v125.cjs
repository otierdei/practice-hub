// E2E ph-v125: Takt Loop im Baustein (wie Musora). Loop antippen, ersten und letzten Takt antippen,
// nur dieser Bereich läuft in Schleife; ein einzelner Takt geht auch; Loop aus spielt wieder alles.
// Läuft auf einem frischen dev-server (eigene Testdaten). Screenshots nach SHOTS.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const t = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  await t.evaluate(async () => {
    const sid = (await api('/api/t/song/create', { title: 'Loop Song' })).id;
    await api('/api/t/song/bpm', { song_id: sid, bpm: 120, source: 'Oti' });
    const tr = { hh: [], sn: [], bd: [] }; for (let bar = 0; bar < 4; bar++) { for (let k = 0; k < 16; k += 2) tr.hh.push(bar * 16 + k); tr.sn.push(bar * 16 + 4, bar * 16 + 12); tr.bd.push(bar * 16, bar * 16 + 8); }
    await api('/api/t/song/part/save', { song_id: sid, title: 'Groove 4 Takte', notation: { sig: '4/4', bars: 4, bpm: 120, tracks: tr } });
    const st = (await api('/api/t/student/save', { first_name: 'Lea', birth_year: 1995, weekday: 2, lesson_time: '18:00', instrument: 'Schlagzeug', status: 'aktiv' })).id;
    S.data = await api('/api/home'); S.file = await api('/api/t/student', { id: st }); startPreview(await api('/api/t/preview', { id: st }));
    S.song = await api('/api/song', { id: sid }); openOverlay(songView);
  });
  await t.locator('[data-act=partPractice]').first().click(); await t.locator('#clockRing').waitFor();
  await t.locator('[data-act=loopMode]').waitFor(); ok('Loop Knopf beim Baustein mit 4 Takten');

  // Ohne Loop: alle 4 Takte
  await t.evaluate(() => { window.__steps = []; const f = DrumNotation.play; window.__origPlay = f; });
  await t.click('[data-act=loopMode]');
  assert.equal(await t.getAttribute('[data-act=loopMode]', 'aria-pressed'), 'true');
  await t.getByText('Tippe auf den ersten Takt').waitFor();
  const hits = t.locator('#practiceStaff .nt-narrow [data-act=loopBar]');
  assert.equal(await hits.count(), 4, 'jeder Takt antippbar');
  await hits.nth(1).click({ force: true }); await t.getByText('Takt 2 gewählt').waitFor();
  await hits.nth(2).click({ force: true });
  await t.getByText('Schleife: Takt 2 bis 3').waitFor();
  assert.deepEqual(await t.evaluate(() => store.get('run').loop), { from: 1, to: 3 });
  assert.equal(await t.locator('#practiceStaff .nt-narrow .nt-loop-a').count(), 1); assert.equal(await t.locator('#practiceStaff .nt-narrow .nt-loop-b').count(), 1);
  await t.locator('#practiceStaff').scrollIntoViewIfNeeded(); await t.screenshot({ path: OUT + '/v125-1-loop-takt-2-3-390-dark.png' });
  ok('Takt 2 und 3 gewählt, markiert, gespeichert');

  // Abspielen: nur Schritte 16 bis 47
  await t.evaluate(() => { const o = DrumNotation.cursorFor; DrumNotation.cursorFor = (root) => { const c = o(root); return (i) => { if (i >= 0) window.__steps.push(i); c(i); }; }; });
  await t.click('[data-act=beatPlay]'); await t.waitForTimeout(6000);
  { const st = await t.evaluate(() => window.__steps); assert.ok(st.length > 30, 'spielt, ' + st.length);
    assert.ok(st.every((i) => i >= 16 && i < 48), 'nur Takt 2 und 3: ' + Math.min(...st) + ' bis ' + Math.max(...st));
    assert.ok(st.includes(16) && st.some((i) => i >= 40), 'beide Takte'); }
  assert.deepEqual(await t.evaluate(() => DrumNotation.loop()), { from: 1, to: 3 });
  ok('Spielt nur Takt 2 bis 3 in Schleife');

  // Während des Spielens: einzelner Takt 4
  await hits.nth(3).click({ force: true }); await hits.nth(3).click({ force: true });
  await t.getByText('Schleife: Takt 4').waitFor();
  await t.evaluate(() => { window.__steps = []; }); await t.waitForTimeout(2500);
  { const st = await t.evaluate(() => window.__steps);  assert.ok(st.length > 10); assert.ok(st.every((i) => i >= 48 && i < 64), 'nur Takt 4: ' + Math.min(...st) + ' bis ' + Math.max(...st)); }
  ok('Einzelner Takt live umgestellt, spielt nur Takt 4');

  // Loop aus: wieder alles
  await t.click('[data-act=loopMode]'); assert.equal(await t.getAttribute('[data-act=loopMode]', 'aria-pressed'), 'false');
  assert.equal(await t.evaluate(() => store.get('run').loop), null);
  assert.equal(await t.locator('#practiceStaff [data-act=loopBar]').count(), 0);
  await t.evaluate(() => { window.__steps = []; }); await t.waitForTimeout(9000);
  { const st = await t.evaluate(() => window.__steps); assert.ok(st.some((i) => i < 16) && st.some((i) => i >= 16), 'ganzer Baustein: ' + Math.min(...st) + ' bis ' + Math.max(...st)); }
  await t.click('[data-act=beatPlay]');
  ok('Loop aus: ganzer Baustein spielt wieder');

  // Uhr läuft weiter (Loop zählt als Üben)
  assert.ok(await t.evaluate(() => store.get('run').runningSince));
  // Kein seitliches Scrollen
  assert.ok(await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); ok('Stoppuhr läuft, kein seitliches Scrollen');

  assert.deepEqual(errors, []); ok('Keine JavaScript Fehler');
  console.log('ALLE ' + n + ' E2E V125 SCHRITTE GRÜN');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
