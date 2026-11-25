// E2E ph-v126: Beats schreiben zählt als Übezeit, markiert mit "Beat geschrieben".
// 1. Ohne laufende Sitzung: Editor öffnen startet eine Schreib Sitzung, Verlassen speichert sie (ab 1 Minute).
// 2. Unter 1 Minute: nichts gespeichert.
// 3. In einer laufenden Übungssitzung: Tippen im Editor hält die Uhr am Leben, Sitzung bekommt die Markierung.
// Läuft auf einem frischen dev-server.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const t = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  const { code, st } = await t.evaluate(async () => {
    const st = (await api('/api/t/student/save', { first_name: 'Tim', birth_year: 1990, weekday: 2, lesson_time: '18:00', instrument: 'Schlagzeug', status: 'aktiv' })).id;
    const ex = (await api('/api/t/exercise/save', { title: 'Schreib Groove', category: 'Grooves', target_bpm: 90 })).id;
    await api('/api/t/assignments/new', { student_id: st, items: [{ exercise_id: ex, minutes_per_day: 20 }] });
    return { st, code: (await api('/api/t/access/create', { student_id: st, role: 'student' })).code };
  });
  const s = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage(); s.on('pageerror', (e) => errors.push(e.message));
  await s.goto(APP); await s.fill('#code', code); await s.click('button[type=submit]');
  await s.locator('[data-act=myBeatNew]').first().waitFor({ timeout: 5000 }).catch(async () => { const c = s.locator('[data-act=consent]'); if (await c.count()) await c.click(); });
  const run = () => s.evaluate(() => JSON.parse(localStorage.getItem('ph_run')));
  const notes = () => t.evaluate(async (st) => (await api('/api/t/student', { id: st })).sessions.map((x) => [x.seconds, x.note]), st);

  // 1. Beat schreiben ohne Sitzung, 3 Minuten
  await s.click('[data-act=myBeatNew]'); await s.locator('#myBeatForm').waitFor();
  { const r = await run(); assert.ok(r && r.writeOnly && r.runningSince, 'Schreib Sitzung läuft'); }
  await s.evaluate(() => { const r = JSON.parse(localStorage.getItem('ph_run')); r.runningSince -= 3 * 60000; localStorage.setItem('ph_run', JSON.stringify(r)); });
  await s.fill('#mb_title', 'Mein Groove'); await s.click('.nt-cell[data-nt=mb][data-k=sn][data-i="4"]');
  await s.click('#myBeatForm button[type=submit]');
  await s.getByText('min Beat schreiben gespeichert').waitFor();
  assert.equal(await run(), null, 'Schreib Sitzung beendet');
  await s.waitForFunction(() => (JSON.parse(localStorage.getItem('ph_outbox') || '[]')).length === 0);
  { const ns = await notes(); assert.equal(ns.length, 1); assert.ok(ns[0][0] >= 179 && ns[0][0] <= 190, 'etwa 3 min, war ' + ns[0][0]); assert.equal(ns[0][1], 'Beat geschrieben'); }
  ok('Beat schreiben ohne Sitzung: 3 min gespeichert, markiert "Beat geschrieben"');

  // 2. Unter einer Minute: nichts
  await s.click('[data-act=myBeatNew]'); await s.locator('#myBeatForm').waitFor();
  assert.ok((await run()).writeOnly);
  await s.click('[data-act=close]'); await s.waitForTimeout(1500);
  assert.equal(await run(), null); assert.equal((await notes()).length, 1, 'keine neue Sitzung');
  ok('Unter 1 Minute schreiben: nichts gespeichert');

  // 3. In laufender Übungssitzung: Tippen im Editor ist Lebenszeichen
  await s.click('.card:has-text("Schreib Groove") [data-act=practice]'); await s.waitForTimeout(300);
  await s.evaluate(() => { S.myBeatBack = true; S.myBeat = {}; S.nt = S.nt || {}; S.nt.mb = DrumNotation.empty('4/4', 1, 70); openOverlay(myBeatView); S.mbSnap = mbState(); startWriteRun(); });
  { const r = await run(); assert.ok(!r.writeOnly, 'keine zweite Sitzung'); }
  await s.evaluate(() => { GUARD.last = Date.now() - 4 * 60000 - 50000; });
  await s.click('.nt-cell[data-nt=mb][data-k=sn][data-i="4"]'); await s.waitForTimeout(1300);
  { const r = await run(); assert.ok(r.runningSince, 'läuft weiter'); assert.equal(r.wrote, true); }
  await s.evaluate(() => { GUARD.last = Date.now() - 5 * 60000 - 500; }); await s.waitForTimeout(1300);
  assert.equal((await run()).paused, 'idle', 'ohne Tippen trotzdem Stopp nach 5 min');
  await s.click('.nt-cell[data-nt=mb][data-k=bd][data-i="0"]'); await s.waitForTimeout(300);
  assert.ok((await run()).runningSince, 'Tippen setzt fort');
  ok('In der Sitzung: Tippen im Editor hält die Uhr am Leben und setzt nach Pause fort');
  await s.evaluate(() => { const r = JSON.parse(localStorage.getItem('ph_run')); r.accumulated = 2 * 60000; localStorage.setItem('ph_run', JSON.stringify(r)); S.mbSnap = null; backToPracticeFromBeat(); });
  await s.click('[data-act=endPractice]'); await s.locator('#finishForm').waitFor(); await s.click('#finishForm button[type=submit]');
  await s.getByText('min gespeichert').first().waitFor();
  await s.waitForFunction(() => (JSON.parse(localStorage.getItem('ph_outbox') || '[]')).length === 0);
  { const ns = await notes(); assert.equal(ns.length, 2); assert.ok(ns.some((x) => x[1] === 'Beat geschrieben' && x[0] >= 120 && x[0] < 140), JSON.stringify(ns)); }
  ok('Übungssitzung mit Beat schreiben: Notiz "Beat geschrieben"');

  assert.deepEqual(errors, []); ok('Keine JavaScript Fehler');
  console.log('ALLE ' + n + ' E2E V126 SCHRITTE GRÜN');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
