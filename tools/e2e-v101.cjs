// E2E ph-v101: Bausteine sortieren, nach dem Üben zurück zum Song, Übetage in der Stunde, Sticking über den Noten.
// Läuft nach tools/e2e.cjs auf demselben dev-server (braucht Schüler und Song von dort).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const tc = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const t = await tc.newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP);
  await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();

  // Song mit drei Bausteinen, einer mit Sticking
  const sid = await t.evaluate(async () => {
    const sid = (await api('/api/t/song/create', { title: 'Sortier Song' })).id;
    await api('/api/t/song/bpm', { song_id: sid, bpm: 80, source: 'Oti' });
    const nt = (stick) => ({ sig: '4/4', bars: 1, bpm: 80, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14], sn: [4, 12], bd: [0, 8] }, stick });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Intro', notation: nt({ 0: 'R', 2: 'L', 4: 'R', 6: 'L' }) });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Vers', notation: nt({}) });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Chorus', notation: nt({}) });
    await openSong(sid); return sid;
  });
  await t.locator('[data-sort-kind=parts] [data-drag]').first().waitFor();
  assert.equal(await t.locator('[data-sort-kind=parts] [data-drag]').count(), 3); ok('Griffe an allen Bausteinen');
  await t.setViewportSize({ width: 1440, height: 1500 });
  await t.getByRole('heading', { name: 'Bausteine' }).evaluate((e) => e.scrollIntoView());
  await t.screenshot({ path: OUT + '/v101-1-bausteine-griffe.png' });

  // Chorus nach oben ziehen
  const h = t.locator('[data-sort-kind=parts] [data-drag]').nth(2), first = t.locator('[data-sort-kind=parts] > section').first();
  const hb = await h.boundingBox(), fb = await first.boundingBox();
  await t.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await t.mouse.down();
  for (let i = 1; i <= 10; i++) await t.mouse.move(hb.x + hb.width / 2, hb.y + (fb.y + 5 - hb.y) * i / 10);
  await t.mouse.up(); await t.getByText('Reihenfolge gespeichert').waitFor();
  const titles = await t.evaluate(async (sid) => (await api('/api/song', { id: sid })).parts.map((p) => p.title), sid);
  assert.deepEqual(titles, ['Chorus', 'Intro', 'Vers']); ok('Ziehen speichert die Reihenfolge auf dem Server');
  assert.deepEqual(await t.evaluate(() => [...document.querySelectorAll('[data-sort-kind=parts] > section b.task-title')].map((x) => x.textContent)), ['Chorus', 'Intro', 'Vers']); ok('Anzeige in neuer Reihenfolge');

  // Sticking über den Noten
  const st = await t.evaluate(() => { const tx = [...document.querySelectorAll('.nt-stick-txt')]; const svg = tx[0] && tx[0].closest('svg'); const top = svg ? Math.min(...[...svg.querySelectorAll('line')].map((l) => Number(l.getAttribute('y1')))) : null; return { n: tx.length, y: tx[0] ? Number(tx[0].getAttribute('y')) : null, top }; });
  assert.ok(st.n >= 4 && st.y < st.top, 'Sticking oberhalb der obersten Notenlinie: ' + JSON.stringify(st)); ok('Sticking steht über den Noten');
  await t.locator('.nt-stick-txt').first().evaluate((e) => e.closest('section').scrollIntoView());
  await t.screenshot({ path: OUT + '/v101-2-sticking-oben.png', clip: { x: 300, y: 0, width: 840, height: 700 } });

  // Schüleransicht: Baustein üben, beenden, zurück im Song
  await t.setViewportSize({ width: 390, height: 844 });
  await t.evaluate(async (sid) => { const st = S.data.students[0]; S.previewFrom = S.overlay; S.file = await api('/api/t/student', { id: st.id }); startPreview(await api('/api/t/preview', { id: st.id })); S.song = await api('/api/song', { id: sid }); openOverlay(songView); }, sid);
  await t.locator('[data-act=partPractice]').first().click(); await t.locator('#clockRing').waitFor();
  await t.evaluate(() => { const r = store.get('run'); r.runningSince -= 2 * 60000; store.set('run', r); });
  await t.click('[data-act=endPractice]'); await t.click('#finishForm button[type=submit]');
  await t.locator('#songAfter').waitFor();
  assert.equal(await t.textContent('.sheet h1'), 'Sortier Song'); ok('Nach dem Üben zurück im Song, nicht auf der Startseite');
  assert.ok(await t.locator('#songAfter').getByText('Oder unten einen anderen Baustein üben.').count());
  assert.ok((await t.locator('[data-act=partPractice]').count()) >= 3); ok('Andere Bausteine direkt übbar');
  await t.screenshot({ path: OUT + '/v101-3-zurueck-im-song.png' });
  await t.locator('[data-act=partPractice]').nth(1).click(); await t.locator('#clockRing').waitFor();
  assert.match(await t.textContent('.sheet h1'), /Intro/); ok('Nächsten Baustein sofort starten');
  await t.evaluate(() => { clearInterval(tickTimer); store.del('run'); closeOverlay(); });

  // Stunde: Kreise antippen zeigt Tage und Zeiten
  await t.setViewportSize({ width: 1440, height: 900 });
  await t.goto(APP); await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  await t.evaluate(async () => { await openLesson(S.data.students[0].id); });
  await t.locator('.ring-btn').waitFor();
  // Testdaten: letzte Stunde vor 5 Tagen, Sitzungen an zwei Tagen (nur im Browser, nichts gespeichert)
  await t.evaluate(() => { const day = (k) => localDate(new Date(Date.now() - k * 864e5)); const at = (k, h, m) => { const d = new Date(Date.now() - k * 864e5); d.setHours(h, m, 0, 0); return d.toISOString(); };
    S.file.lessons[0].date = day(5); const a = S.file.assignments[0];
    S.file.sessions = [{ local_date: day(4), started_at: at(4, 17, 5), seconds: 720, assignment_id: a.id, bpm_reached: 84, feeling: 4 }, { local_date: day(4), started_at: at(4, 19, 40), seconds: 300, note: 'Baustein: Chorus' }, { local_date: day(1), started_at: at(1, 16, 15), seconds: 1500, assignment_id: a.id }].concat(S.file.sessions); render(); });
  await t.click('.ring-btn');
  await t.locator('#practiceDays').waitFor();
  const days = await t.locator('#practiceDays .day-row').count(); assert.ok(days >= 1); ok('Kreise antippen: ' + days + ' Tage mit Zeiten');
  await t.locator('#practiceDays').scrollIntoViewIfNeeded();
  await t.screenshot({ path: OUT + '/v101-4-uebetage.png' });
  console.log(await t.locator('#practiceDays').innerText());
  assert.ok(await t.locator('#practiceDays').getByText(/Uhr · \d+ min/).count()); ok('Uhrzeit und Minuten pro Sitzung');

  assert.deepEqual(errors, []); console.log('ALLE ' + n + ' SCHRITTE GRÜN (v101)');
  await b.close();
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
