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
  { const labels = await t.locator('#practiceDays .day-row b').allTextContents(); assert.equal(labels[0], await t.evaluate(() => fmtDate(localDate())), 'heute oben'); assert.ok(labels.some((l) => / bis /.test(l)), 'Lücke zusammengefasst'); ok('Neuester Tag oben, Lücken in einer Zeile'); }
  // Echte Sitzung mit 360 min anlegen (Schüler Link) und in der Akte löschen
  await t.evaluate(() => { S.file.sessions.unshift({ id: 'nichtda', local_date: localDate(), started_at: new Date().toISOString(), seconds: 21600 }); S.practiceDays = true; render(); });
  await t.locator('#practiceDays').getByText('ungewöhnlich lang').waitFor(); ok('360 min als ungewöhnlich lang markiert');
  await t.screenshot({ path: OUT + '/v102-1-uebetage-neu-oben.png' });
  await t.locator('#practiceDays [data-act=sessDelete][data-id=nichtda]').click(); await t.getByText('Wirklich löschen?').waitFor();
  await t.locator('#practiceDays [data-act=sessDelete][data-id=nichtda]').click(); await t.getByText('Sitzung nicht gefunden.').waitFor(); ok('Löschen fragt erst nach, Server prüft');
  // Abgeschlossene Songs aus Notizen: in älterer Stunde erwähnt, in der neuesten nicht
  await t.evaluate(() => { const L = S.file.lessons[0]; S.file.lessons = [{ ...L, id: 'neu', date: localDate(), notes_teacher: 'Nur Groove geübt' }, { ...L, id: 'alt', date: '2026-10-01', notes_teacher: 'Sortier Song Strophe sauber, Tempo Song E2E angefangen' }];
    S.file.assignments.push({ id: 'oa', song_id: S.songs.songs.find((x) => x.title === 'Tempo Song E2E').id, status: 'offen', title: 'Tempo Song E2E' }); render(); });
  await t.locator('#a_doneSongs .chip:has-text("Sortier Song")').waitFor();
  assert.equal(await t.locator('#a_doneSongs .chip:has-text("Tempo Song E2E")').count(), 0, 'offene Hausaufgabe zählt nicht als abgeschlossen');
  await t.locator('#a_doneSongs').screenshot({ path: OUT + '/v102-3-abgeschlossen-notizen.png' }); ok('Song aus älteren Notizen steht bei Abgeschlossene Songs');
  await t.evaluate(() => closeOverlay()); await t.evaluate(async () => { S.file = await api('/api/t/student', { id: S.data.students[0].id }); const day = (k) => localDate(new Date(Date.now() - k * 864e5)); S.file.sessions = [{ id: 'x1', local_date: day(2), started_at: new Date(Date.now() - 2 * 864e5).toISOString(), seconds: 21600 }, { id: 'x2', local_date: day(0), started_at: new Date().toISOString(), seconds: 900, note: 'Baustein: Chorus' }].concat(S.file.sessions); openOverlay(studentFileView); });
  await t.locator('#fileSess').waitFor(); await t.click('#fileSess summary'); await t.locator('#fileSess').screenshot({ path: OUT + '/v102-2-akte-sitzungen.png' }); ok('Akte zeigt Übungssitzungen');

  // ph-v103: Großer Üben Knopf startet Aufgabe 1, dann durchklicken
  await t.evaluate(() => closeOverlay());
  await t.setViewportSize({ width: 390, height: 844 });
  await t.evaluate(async () => { const st = S.data.students[0]; S.previewFrom = null; S.file = await api('/api/t/student', { id: st.id }); startPreview(await api('/api/t/preview', { id: st.id })); stuData().assignments.push({ id: 'pv-extra', title: 'Extra Aufgabe', status: 'offen', minutes_per_day: 10, created_at: new Date().toISOString() }); render(); });
  const list = await t.evaluate(() => tourList().map((a) => a.title || a.free_text));
  assert.ok(list.length >= 3, 'mindestens 3 offene Aufgaben: ' + list.length);
  await t.click('.practice-hero'); await t.locator('#clockRing').waitFor();
  assert.equal((await t.textContent('.sheet h1')).trim(), list[0]); await t.getByText('Aufgabe 1 von ' + list.length).waitFor(); ok('Üben Knopf startet direkt Aufgabe 1');
  await t.screenshot({ path: OUT + '/v103-1-aufgabe1.png' });
  await t.click('.tour-nav [data-act=tourGo]:has-text("Nächste")'); await t.getByText('Aufgabe 2 von ' + list.length).waitFor();
  assert.equal((await t.textContent('.sheet h1')).trim(), list[1]); ok('Unter 1 min: Nächste wechselt sofort');
  await t.evaluate(() => { const r = store.get('run'); r.runningSince -= 3 * 60000; store.set('run', r); });
  await t.click('.tour-nav [data-act=tourGo]:has-text("Nächste")'); await t.getByText('Speichern und weiter zur nächsten Aufgabe').waitFor();
  await t.screenshot({ path: OUT + '/v103-2-speichern-weiter.png' });
  await t.click('#finishForm button[type=submit]'); await t.getByText('Aufgabe 3 von ' + list.length).waitFor();
  assert.equal((await t.textContent('.sheet h1')).trim(), list[2]);
  assert.equal(await t.evaluate(() => stuData().sessions.filter((x) => x.seconds >= 170).length > 0), true, 'Sitzung von Aufgabe 2 gespeichert'); ok('Ab 1 min: erst speichern, dann Aufgabe 3');
  await t.click('.tour-nav [data-act=tourGo]:has-text("Vorherige")'); await t.getByText('Aufgabe 2 von ' + list.length).waitFor(); ok('Vorherige geht zurück');
  await t.evaluate(() => { clearInterval(tickTimer); store.del('run'); closeOverlay(); });
  // ph-v105: ganzer Song ohne Baustein endet auf der Startseite
  await t.evaluate(async () => { const sg = S.songs.songs.find((x) => x.title === 'Tempo Song E2E'); stuData().assignments.unshift({ id: 'pv-song', title: 'Tempo Song E2E', song_id: sg.id, status: 'offen', minutes_per_day: 10, created_at: new Date().toISOString() }); await goTask('pv-song'); });
  await t.locator('#clockRing').waitFor(); await t.evaluate(() => { const r = store.get('run'); r.runningSince -= 2 * 60000; store.set('run', r); });
  await t.click('[data-act=endPractice]'); await t.click('#finishForm button[type=submit]'); await t.waitForTimeout(800);
  assert.equal(await t.evaluate(() => S.overlay), null, 'Startseite statt Song'); assert.equal(await t.locator('#songAfter').count(), 0); ok('Ganzer Song mit Video: zurück auf die Startseite');
  assert.deepEqual(errors, []); console.log('ALLE ' + n + ' SCHRITTE GRÜN (v101)');
  await b.close();
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
