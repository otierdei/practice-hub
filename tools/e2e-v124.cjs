// E2E ph-v124: Übezeit geht nicht mehr verloren.
// 1. Roadmap Player zählt als Üben (keine Warnung, kein Stopp).
// 2. Nach Pause wegen Hintergrund, App weg oder Stille läuft die Uhr weiter, sobald Ton läuft oder angetippt wird.
// 3. Rudiments und Technik: 10 stille Minuten statt 5.
// 4. Von Hand pausiert bleibt pausiert.
// Läuft auf einem frischen dev-server (eigene Testdaten).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const t = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  const code = await t.evaluate(async () => {
    const st = (await api('/api/t/student/save', { first_name: 'Ben', birth_year: 1990, weekday: 2, lesson_time: '18:00', instrument: 'Schlagzeug', status: 'aktiv' })).id;
    const groove = (await api('/api/t/exercise/save', { title: 'Zeit Groove', category: 'Grooves', target_bpm: 90 })).id;
    const pad = (await api('/api/t/exercise/save', { title: 'Zeit Paradiddle', category: 'Rudiments', target_bpm: 100 })).id;
    await api('/api/t/assignments/new', { student_id: st, items: [{ exercise_id: groove, minutes_per_day: 30 }, { exercise_id: pad, minutes_per_day: 30 }] });
    return (await api('/api/t/access/create', { student_id: st, role: 'student' })).code;
  });
  const s = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage(); s.on('pageerror', (e) => errors.push(e.message));
  await s.goto(APP); await s.fill('#code', code); await s.click('button[type=submit]');
  await s.locator('.card:has-text("Zeit Groove") [data-act=practice]').waitFor({ timeout: 5000 }).catch(async () => { const c = s.locator('[data-act=consent]'); if (await c.count()) await c.click(); });
  await s.locator('.card:has-text("Zeit Groove") [data-act=practice]').waitFor();

  const run = () => s.evaluate(() => JSON.parse(localStorage.getItem('ph_run')));
  const set = (f) => s.evaluate(f);
  const hide = (h) => s.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, h);

  await s.click('.card:has-text("Zeit Groove") [data-act=practice]'); await s.waitForTimeout(300);
  assert.ok((await run()).runningSince, 'läuft');

  // 1. Roadmap spielt: zählt als Aktivität
  await set(() => { window.__rm = Roadmap.isPlaying; Roadmap.isPlaying = () => true; GUARD.last = Date.now() - 6 * 60000; });
  await s.waitForTimeout(1300);
  { const r = await run(); assert.ok(r.runningSince, 'Roadmap hält die Uhr am Leben'); assert.equal(await s.locator('#idleWarn').count(), 0); }
  await set(() => { Roadmap.isPlaying = window.__rm; });
  ok('Roadmap Player zählt als Üben, keine Warnung, kein Stopp');

  // 2a. Bildschirm gesperrt, zurück, Antippen setzt fort
  await hide(true); assert.equal((await run()).paused, 'hidden');
  await hide(false); await s.getByText('Stoppuhr pausiert').waitFor();
  await s.getByText('Sobald du weiterspielst oder tippst').waitFor();
  await s.evaluate(() => scrollTo(0, 0)); await s.screenshot({ path: OUT + '/v124-1-pause-hinweis-390-dark.png' });
  await s.locator('h1, h2, h3').first().dispatchEvent('pointerdown');
  await s.waitForTimeout(300);
  { const r = await run(); assert.ok(r.runningSince, 'Antippen setzt fort'); assert.equal(r.paused, null); }
  assert.equal(await s.locator('#pausedNote').count(), 0);
  ok('Nach Bildschirmsperre: Antippen startet die Uhr wieder');

  // 2b. Stille Pause, Metronom startet: Uhr läuft von selbst
  await set(() => { const r = JSON.parse(localStorage.getItem('ph_run')); const n = Date.now(); r.accumulated = 0; r.runningSince = n - 20 * 60000; r.hb = n; localStorage.setItem('ph_run', JSON.stringify(r)); GUARD.last = n - 5 * 60000 - 500; });
  await s.waitForTimeout(1300);
  { const r = await run(); assert.equal(r.paused, 'idle'); assert.equal(r.runningSince, null); const m = r.accumulated / 60000; assert.ok(m > 14.9 && m < 15.1, '15 min, war ' + m); }
  await set(() => metStart()); await s.waitForTimeout(1300);
  { const r = await run(); assert.ok(r.runningSince, 'Metronom setzt fort'); assert.equal(r.paused, null); }
  await set(() => metStop());
  ok('Nach Stille: Metronom starten lässt die Uhr von selbst weiterlaufen');

  // 4. Von Hand pausiert: Ton und Antippen ändern nichts
  await s.click('#clockRing'); await s.waitForTimeout(200);
  { const r = await run(); assert.equal(r.runningSince, null); assert.ok(!r.paused); }
  await set(() => metStart()); await s.waitForTimeout(1300); await set(() => metStop());
  await s.locator('h1, h2, h3').first().dispatchEvent('pointerdown'); await s.waitForTimeout(300);
  assert.equal((await run()).runningSince, null, 'bleibt pausiert');
  ok('Von Hand pausiert bleibt pausiert');

  // Ende speichert ohne Fortsetzen
  await s.click('[data-act=endPractice]'); await s.locator('#finishForm').waitFor();
  assert.equal((await run()).runningSince, null, 'Beenden startet die Uhr nicht');
  await s.click('#finishForm button[type=submit]'); await s.getByText('min gespeichert').waitFor();
  ok('Beenden nach Pause zählt keine Extra Zeit');

  // 3. Rudiments: 9 Minuten still ohne Stopp und ohne Warnung bei 5, Warnung bei 9, Stopp bei 10
  await s.click('.card:has-text("Zeit Paradiddle") [data-act=practice]'); await s.waitForTimeout(300);
  await set(() => { GUARD.last = Date.now() - 5 * 60000 - 500; }); await s.waitForTimeout(1300);
  { const r = await run(); assert.ok(r.runningSince, 'nach 5 min noch an'); assert.equal(await s.locator('#idleWarn').count(), 0); }
  await set(() => { GUARD.last = Date.now() - 9 * 60000 - 500; }); await s.locator('#idleWarn').waitFor();
  assert.match(await s.textContent('#idleWarn'), /Seit 9 Minuten/);
  await set(() => { GUARD.last = Date.now() - 10 * 60000 - 500; }); await s.waitForTimeout(1300);
  { const r = await run(); assert.equal(r.paused, 'idle'); }
  await s.getByText('Pausiert nach 10 Minuten').waitFor();
  ok('Rudiments: 10 stille Minuten, Warnung bei 9');

  assert.deepEqual(errors, []); ok('Keine JavaScript Fehler');
  console.log('ALLE ' + n + ' E2E V124 SCHRITTE GRÜN');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
