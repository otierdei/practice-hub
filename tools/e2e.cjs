// End to end Test: Lehrer legt an, Schüler übt, Eltern willigen ein. Läuft gegen tools/dev-server.mjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const ctx = (opts) => b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], ...opts });

  // Lehrer am Mac
  const tc = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const t = await tc.newPage(); t.on('pageerror', (e) => errors.push('Lehrer: ' + e.message));
  await t.goto(APP);
  await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor(); ok('Lehrer Login');

  // Übung anlegen
  await t.click('[data-tab=bibliothek]'); await t.click('[data-act=newExercise]');
  await t.fill('#e_title', 'Paradiddle Groove'); await t.fill('#e_cat', 'Grooves'); await t.selectOption('#e_src', 'youtube');
  await t.fill('#e_url', 'https://www.youtube.com/watch?v=beispiel'); await t.fill('#e_bpm', '96'); await t.click('#exerciseForm button[type=submit]');
  await t.getByText('Paradiddle Groove').waitFor(); ok('Übung angelegt');

  // Schüler anlegen, heute um jetzt
  const now = new Date(); const wd = ((now.getDay() + 6) % 7) + 1;
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(Math.max(0, now.getMinutes() - 5)).padStart(2, '0');
  await t.click('[data-tab=schueler]'); await t.click('[data-act=newStudent]');
  await t.fill('#f_first', 'Jonas'); await t.fill('#f_birth', '2012'); await t.selectOption('#f_wd', String(wd)); await t.fill('#f_time', time);
  await t.click('#studentForm button[type=submit]');
  await t.getByRole('heading', { name: 'Jonas', exact: true }).waitFor(); ok('Schüler angelegt, Akte offen');

  // Links erzeugen
  await t.click('[data-act=newAccess][data-role=student]'); await t.locator('#newLink').waitFor();
  const studentLink = (await t.textContent('#newLink')).trim();
  await t.click('[data-act=newAccess][data-role=parent]');
  await t.waitForFunction((old) => document.querySelector('#newLink').textContent.trim() !== old, studentLink);
  const parentLink = (await t.textContent('#newLink')).trim();
  assert.match(studentLink, /#c=[A-Z0-9]{10}$/); assert.notEqual(studentLink, parentLink); ok('Schüler und Elternlink');
  await t.screenshot({ path: OUT + '/t-akte-1440.png' });

  // Stunde starten von Heute
  await t.click('[data-act=close]'); await t.click('[data-tab=heute]');
  await t.getByText('Gerade dran').waitFor(); ok('Heute zeigt Jonas als gerade dran');
  await t.click('section[aria-label="Gerade dran"] [data-act=lesson]');
  await t.getByText('Hausaufgabe hinzufügen').waitFor(); if (await t.locator('#warmBox').count()) { assert.equal(await t.locator('#warmBox').evaluate((d) => d.open), false); ok('Aufwärmen zugeklappt'); } if (await t.locator('#sugBox').count()) { assert.equal(await t.locator('#sugBox').evaluate((d) => d.open), false); ok('Vorschläge zugeklappt'); } assert.match(await t.textContent('#lessonPractice'), /Geübt seit .*: \d+ min an \d von 7 Tagen/); ok('Übungszeit oben in der Stunde');
  assert.equal(await t.inputValue('#a_from'), '45'); assert.equal(await t.inputValue('#a_bpm'), '100');
  await t.selectOption('#a_ex', { label: 'Grooves: Paradiddle Groove' });
  assert.equal(await t.inputValue('#a_from'), '45'); assert.equal(await t.inputValue('#a_bpm'), '96'); ok('Tempo Standard 45 bis 100, eigenes Ziel der Übung gilt');
  await t.fill('#a_min', '15'); await t.click('#assignForm button[type=submit]');
  await t.fill('#a_free', 'Heilige Braut, Strophe mitspielen'); await t.click('#assignForm button[type=submit]');
  await t.click('[data-act=newAsgOpen][data-i="1"]'); await t.fill('#na_from', '50'); await t.fill('#na_to', '80'); await t.fill('#na_text', 'Heilige Braut, Strophe und Refrain'); await t.click('[data-act=newAsgSave]');
  await t.getByText('Heilige Braut, Strophe und Refrain').waitFor(); assert.match(await t.textContent('.item:has-text("Strophe und Refrain")'), /50 bis 80 BPM/); ok('Neue Hausaufgabe antippen und vor dem Speichern ändern');
  await t.fill('#g_title', 'Groove sauber auf 96'); await t.click('#goalForm button[type=submit]');
  await t.fill('#l_shared', 'Hi Hat locker lassen.'); await t.fill('#l_priv', 'Wirkte müde');
  // Entwurf überlebt Neuladen
  await t.reload(); await t.click('[data-tab=heute]'); await t.click('section[aria-label="Gerade dran"] [data-act=lesson]');
  assert.equal(await t.inputValue('#l_shared'), 'Hi Hat locker lassen.'); ok('Stundenentwurf überlebt Neuladen');
  await t.screenshot({ path: OUT + '/t-stunde-1440.png' });
  await t.click('[data-act=finishLesson]'); await t.getByText(/Stunde (gespeichert|von heute ergänzt)/).waitFor(); ok('Stunde beendet');

  // Schüler am iPhone öffnet Link
  const sc = await ctx({ colorScheme: 'dark' }); const s = await sc.newPage(); s.on('pageerror', (e) => errors.push('Schüler: ' + e.message));
  await s.goto(studentLink);
  await s.getByRole('heading', { name: 'Heute üben' }).waitFor(); ok('Schüler Login per Link');
  assert.equal(new URL(s.url()).hash, '', 'Code aus der Adresse entfernt'); ok('Code aus Adresszeile entfernt');
  const body = await s.textContent('body');
  assert.ok(body.includes('Paradiddle Groove') && body.includes('Heilige Braut'));
  assert.ok(!body.includes('Wirkte müde'), 'private Notiz unsichtbar'); ok('Schüler sieht Hausaufgaben, nicht die private Notiz');
  await s.screenshot({ path: OUT + '/s-ueben-390-dark.png', fullPage: true });

  // Übungssitzung: Stoppuhr starten, 12 Minuten vorspulen, beenden
  await s.click('.card:has-text("Paradiddle Groove") [data-act=practice]');
  await s.waitForTimeout(300); // Stoppuhr startet beim Öffnen von selbst
  await s.evaluate(() => { const r = JSON.parse(localStorage.getItem('ph_run')); r.runningSince -= 12 * 60000; localStorage.setItem('ph_run', JSON.stringify(r)); });
  await s.click('[data-act=bpm][data-d="5"]');
  await s.click('[data-act=metronome]'); await s.waitForTimeout(400); await s.click('[data-act=metronome]');
  await s.waitForTimeout(300);
  assert.match(await s.textContent('#clockRing'), /12:0\d/); ok('Stoppuhr läuft mit Zeitstempeln');
  await s.screenshot({ path: OUT + '/s-session-390-dark.png' });
  // Neuladen mitten in der Sitzung verliert nichts
  await s.reload(); await s.click('[data-act=resumePractice]');
  assert.match(await s.textContent('#clockRing'), /12:\d\d/); ok('Laufende Sitzung überlebt Neuladen');
  await s.click('[data-act=endPractice]');
  await s.fill('#fin_bpm', '88'); await s.click('[data-act=feel][data-v="4"]'); await s.click('#finishForm button[type=submit]');
  await s.getByText('12 min gespeichert').waitFor(); ok('Sitzung gespeichert');
  await s.waitForFunction(() => (JSON.parse(localStorage.getItem('ph_outbox') || '[]')).length === 0); ok('Ausgang leer, Server hat die Sitzung');

  // Offline üben, dann nachsenden
  await sc.setOffline(true);
  await s.click('[data-act=practiceFree]'); await s.waitForTimeout(200);
  await s.evaluate(() => { const r = JSON.parse(localStorage.getItem('ph_run')); r.runningSince -= 5 * 60000; localStorage.setItem('ph_run', JSON.stringify(r)); });
  await s.click('[data-act=endPractice]'); await s.click('#finishForm button[type=submit]');
  await s.getByText('wird gesendet').waitFor(); ok('Offline: Sitzung wartet im Ausgang');
  await sc.setOffline(false); await s.waitForTimeout(300); await s.evaluate(() => window.dispatchEvent(new Event('online')));
  await s.waitForFunction(() => (JSON.parse(localStorage.getItem('ph_outbox') || '[]')).length === 0); ok('Online: Sitzung nachgesendet');

  await s.click('[data-tab=fortschritt]'); await s.getByText('Tempo').waitFor();
  assert.ok((await s.textContent('body')).includes('88')); ok('Fortschritt zeigt 88 von 96 BPM');
  await s.screenshot({ path: OUT + '/s-fortschritt-390-dark.png', fullPage: true });

  // Eltern
  const pc = await ctx({ colorScheme: 'light' }); const p = await pc.newPage(); p.on('pageerror', (e) => errors.push('Eltern: ' + e.message));
  await p.goto(parentLink);
  await p.getByText('Elternansicht').waitFor();
  assert.ok(!(await p.textContent('body')).includes('Wirkte müde'));
  await p.screenshot({ path: OUT + '/p-390-light.png', fullPage: true });
  await p.click('[data-act=consent]'); await p.getByText('Einwilligung gegeben').waitFor(); ok('Eltern geben Einwilligung');
  assert.equal(await p.locator('[data-act=startStop], [data-act=practice]').count(), 0); ok('Eltern haben keine Übe Buttons');

  // Lehrer sieht Übezeit
  await t.click('[data-tab=schueler]'); await t.reload(); await t.click('[data-tab=schueler]');
  await t.getByText('17 min seit letzter Stunde').waitFor(); ok('Lehrer sieht 17 min (12 + 5)');
  await t.screenshot({ path: OUT + '/t-schueler-1440.png' });
  // Lehrer: Link an Hausaufgabe hängen und Schüleransicht als Vorschau
  await t.locator('[data-act=student]').first().click(); await t.locator('[data-act=preview]').waitFor();
  {
    await t.locator('[data-act=addLink]').first().click();
    await t.locator('input[id^=lki_]').first().fill('youtu.be/dQw4w9WgXcQ');
    await t.locator('[data-act=saveLink]').first().click(); await t.getByText('Link gespeichert').waitFor(); ok('Lehrer hängt YouTube Link an Hausaufgabe');
    const before = await t.evaluate(() => S.file.sessions.length);
    await t.click('.sheet [data-act=preview]'); await t.getByText('Simulation als').waitFor();
    assert.ok(await t.locator('.thumb').count() >= 1); ok('Vorschau zeigt Schüleransicht mit Videobild');
    await t.locator('[data-act=practice]').first().click(); await t.waitForTimeout(300);
    await t.evaluate(() => { const r = JSON.parse(localStorage.getItem('ph_pv_run')); r.runningSince -= 5 * 60000; localStorage.setItem('ph_pv_run', JSON.stringify(r)); });
    await t.click('[data-act=endPractice]'); await t.click('[data-act=feel][data-v="4"]'); await t.click('#finishForm button[type=submit]');
    await t.getByText('5 min gespeichert').waitFor();
    await t.click('[data-act=endPreview]');
    assert.equal(await t.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph_pv_')).length), 0, 'Sandbox geleert');
    assert.equal(await t.evaluate(() => S.role), 'teacher');
    const after = (await t.evaluate(() => api('/api/t/student', { id: S.file.student.id }))).sessions.length;
    assert.equal(after, before, 'Simulation schreibt nichts in die Datenbank'); ok('Simulation: als Schüler üben, nichts gespeichert, Lehrer danach zurück');
    await t.click('[data-act=close]');
  }
  // Import aus Datei (Beispieldaten)
  const seedPath = require('path').join(require('os').tmpdir(), 'ph-seed-test.json');
  require('fs').writeFileSync(seedPath, JSON.stringify([{ first_name: 'Testa', weekday: 2, lesson_time: '10:00', lesson_minutes: 40, instrument: 'Gitarre', profile_note: 'Beispiel', lessons: [{ date: '2025-01-01', minutes: 40, notes_teacher: 'Alt 1' }, { date: '2025-01-08', notes_teacher: 'Alt 2' }], assignments: [{ free_text: 'Akkorde G C D' }] }, { first_name: 'Jonas', lessons: [] }]));
  await t.click('[data-tab=mehr]'); await t.setInputFiles('#importFile', seedPath);
  await t.getByText('Fertig: 1 Schüler, 2 Stunden, 1 Hausaufgaben importiert.').waitFor(); ok('Import aus Datei, vorhandene Schüler übersprungen');
  const tm = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' }); const tp = await tm.newPage();
  await tp.goto(APP); await tp.fill('#code', 'LEHRER2345XY'); await tp.click('button[type=submit]'); await tp.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  await tp.screenshot({ path: OUT + '/t-heute-390-light.png', fullPage: true });

  // Noten Editor: Lehrer schreibt einen Beat, gibt ihn als Hausaufgabe, Schüler sieht und spielt ihn
  await t.click('[data-tab=bibliothek]'); await t.click('[data-act=newBeat]');
  await t.fill('#e_title', 'Rock Beat 1');
  await t.click('.nt-cell[data-k=bd][data-i="10"]');
  assert.equal(await t.getAttribute('.nt-cell[data-k=bd][data-i="10"]', 'aria-pressed'), 'true');
  await t.click('.nt-cell[data-k=ho][data-i="14"]');
  assert.equal(await t.getAttribute('.nt-cell[data-k=hh][data-i="14"]', 'aria-pressed'), 'false', 'HiHat zu und offen schließen sich aus');
  await t.selectOption('#ex-bars', '2'); await t.click('[data-nt-bar="1"]');
  assert.equal(await t.isChecked('[data-nt-ctl=repeat]'), true, 'neuer Takt wiederholt den ersten'); ok('Editor: Schläge setzen, 2 Takte, Takt 2 wiederholt');
  await t.click('[data-nt-act=play]'); await t.waitForTimeout(500); await t.click('[data-nt-act=play]');
  await t.screenshot({ path: OUT + '/t-beat-editor-1440.png', fullPage: true });
  await t.click('#exerciseForm button[type=submit]'); await t.getByText('Rock Beat 1').waitFor();
  assert.ok(await t.locator('.item:has-text("Rock Beat 1") .nt-svg').count() === 1); ok('Beat gespeichert, Notenbild in der Bibliothek');
  await t.click('[data-tab=heute]'); await t.click('section[aria-label="Gerade dran"] [data-act=lesson]');
  await t.selectOption('#a_ex', { label: 'Grooves: Rock Beat 1' }); await t.click('#assignForm button[type=submit]');
  await t.click('[data-act=finishLesson]'); await t.getByText(/Stunde (gespeichert|von heute ergänzt)/).waitFor();
  await s.reload(); await s.getByRole('heading', { name: 'Heute üben' }).waitFor();
  const card = s.locator('.card:has-text("Rock Beat 1")'); assert.equal(await card.locator('.nt-svg').count(), 1); ok('Schüler sieht die Noten');
  await card.locator('[data-act=practice]').click(); await s.click('[data-act=beatPlay]');
  await s.waitForTimeout(600); assert.equal(await s.textContent('[data-act=beatPlay]'), 'Beat stoppen'); await s.click('[data-act=beatPlay]'); ok('Schüler spielt den Beat ab');
  await s.click('[data-act=beatClick]'); assert.equal(await s.getAttribute('[data-act=beatClick]', 'aria-pressed'), 'true');
  await s.click('[data-act=beatPlay]'); await s.waitForTimeout(1500);
  assert.ok(await s.locator('#beats .met-dot.on').count() === 1, 'Punkt leuchtet im Beat'); assert.match(await s.textContent('#trk'), /[1-9]\d* Takte/);
  await s.click('[data-act=beatPlay]'); ok('Metronom im Beat: Klick an, Punkte laufen mit, Tracker zählt Takte');
  await s.selectOption('#met_sig', '3/4'); assert.equal(await s.locator('#beats .met-dot').count(), 3);
  await s.click('#beats .met-dot >> nth=1'); assert.ok(await s.locator('#beats .met-dot >> nth=1').evaluate((d) => d.classList.contains('acc0')));
  await s.click('[data-act=metSub][data-v="3"]'); await s.selectOption('#met_sound', 'holz');
  await s.click('[data-act=metronome]'); await s.waitForTimeout(700); assert.equal(await s.locator('#beats .met-dot.on').count(), 1); await s.click('[data-act=metronome]');
  assert.equal(await s.evaluate(() => DrumNotation.loadSamples().then(() => fetch('samples/hh.mp3').then((r) => r.ok))), true);
  await s.selectOption('#met_sig', '4/4'); ok('Metronom: Taktart, Betonung, Triolen, Klang, Samples geladen');
  await s.screenshot({ path: OUT + '/s-beat-390-dark.png', fullPage: true });
  await s.click('[data-act=minimize]');

  // Song Chart: Teile und Wiederholungstakte
  await t.click('[data-tab=bibliothek]'); await t.click('[data-act=newBeat]'); await t.fill('#e_title', 'Song Chart Test');
  await t.selectOption('#ex-bars', '8'); await t.click('[data-nt-bar="4"]'); await t.fill('#ex-mark', 'Refrain'); await t.press('#ex-mark', 'Tab');
  await t.click('[data-nt-bar="4"]'); await t.uncheck('[data-nt-ctl=repeat]'); await t.click('.nt-cell[data-k=cr][data-i="64"]');
  assert.equal(await t.locator('#ex .nt-svg').count(), 2, 'zwei Notenzeilen bei 8 Takten');
  await t.click('#exerciseForm button[type=submit]'); await t.getByText('Song Chart Test').waitFor(); ok('Song Chart mit Teil und Wiederholungen gespeichert');

  // Gitarre: Akkorde, Schlagmuster, Tab
  await t.click('[data-act=newGuitar]'); await t.fill('#e_title', 'Worship Pattern G');
  await t.selectOption('#gx-add', 'Bm'); await t.click('[data-gt-act=addChord]');
  assert.ok((await t.textContent('#gx')).includes('Bm (Hm)'));
  await t.click('.gt-scell[data-gt-s="1"]'); await t.click('.gt-tcell[data-gt-t="5,0"]'); await t.click('[data-gt-act=fret][data-f="3"]');
  assert.ok((await t.textContent('#gx .gt-tab')).includes('3'));
  await t.click('[data-gt-act=playStrum]'); await t.waitForTimeout(400); await t.click('[data-gt-act=playStrum]');
  await t.screenshot({ path: OUT + '/t-gitarre-1440.png', fullPage: true });
  await t.click('#exerciseForm button[type=submit]'); await t.getByText('Worship Pattern G').waitFor(); ok('Gitarren Übung mit Akkorden, Muster und Tab gespeichert');
  // Jonas auf Gitarre umstellen und Übung geben
  await t.click('[data-tab=schueler]'); await t.click('text=Jonas'); await t.click('[data-act=editStudent]'); await t.selectOption('#f_instr', 'Gitarre'); await t.click('#studentForm button[type=submit]');
  await t.getByText('Gitarre ·').waitFor();
  await t.click('.btn.primary[data-act=lesson]'); await t.selectOption('#a_ex', { label: 'Gitarre: Worship Pattern G' }); await t.click('#assignForm button[type=submit]'); await t.click('[data-act=finishLesson]'); await t.getByText(/Stunde (gespeichert|von heute ergänzt)/).waitFor();
  await s.reload(); await s.getByRole('heading', { name: 'Heute üben' }).waitFor();
  assert.equal(await s.locator('nav [data-tab=stimmen]').count(), 1, 'Gitarrenschüler hat Stimmen'); ok('Gitarrenschüler sieht Tab Stimmen');
  await s.locator('.card:has-text("Worship Pattern G") [data-act=practice]').click();
  assert.ok(await s.locator('#practiceGuitar .gt-chord').count() >= 5); await s.click('[data-act=gtPlay][data-mode=strum]'); await s.waitForTimeout(400); ok('Schüler sieht Akkorde und spielt Schlagmuster');
  await s.screenshot({ path: OUT + '/s-gitarre-390-dark.png' });
  await s.click('[data-act=minimize]'); await s.click('[data-tab=stimmen]'); await s.click('[data-act=tuner]'); await s.waitForTimeout(1500);
  await s.selectOption('#capoKey', 'A'); assert.ok((await s.textContent('body')).includes('Capo 2')); ok('Stimmgerät startet, Capo Helfer rechnet A = G mit Capo 2');
  await s.screenshot({ path: OUT + '/s-stimmen-390-dark.png', fullPage: true });
  await s.click('[data-tab=ueben]');

  // Sperren
  await t.click('[data-tab=schueler]'); await t.click('[data-act=student]:has-text("Jonas")'); await t.click('.item:has-text("Schüler") [data-act=revoke]'); await t.locator('.toast', { hasText: 'Gesperrt' }).waitFor();
  await s.reload(); await s.getByText('Anmelden').waitFor(); ok('Gesperrter Schüler fliegt raus');

  // Baustein mit Notenbild (Claude Antwort lokal gestellt)
  await t.reload(); await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  await t.click('[data-tab=songs]'); await t.click('[data-act=songNew]'); await t.fill('#sn_title', 'Am Kreuz'); await t.click('#songNewForm button[type=submit]');
  await t.waitForTimeout(600); if (!(await t.getByText('Baustein hinzufügen').count())) await t.getByText('Am Kreuz').first().click();
  await t.getByText('Baustein hinzufügen').waitFor(); await t.fill('#pt_notes', 'Hinweis bleibt');
  await t.setInputFiles('#pt_img', __dirname + '/../t-akte-1440.png'); await t.getByText('2 Beispiele erkannt').waitFor();
  assert.equal(await t.inputValue('#pt_title'), 'Beispiel 1'); assert.equal(await t.inputValue('#pt_notes'), 'Hinweis bleibt');
  await t.click('[data-act=ptPick][data-i="1"]'); await t.click('#partForm button[type=submit]'); await t.getByText('Baustein gespeichert').waitFor();
  assert.equal(await t.locator('[data-act=partPlay]').count(), 1); ok('Notenbild transkribiert, Beispiel gewählt, Baustein mit Noten gespeichert');
  await t.click('[data-act=close]');

  // Horizontaler Überlauf am iPhone
  for (const [pg, name] of [[s, 'Schüler'], [p, 'Eltern'], [tp, 'Lehrer iPhone']]) {
    const over = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(over, false, name + ' scrollt seitlich');
  }
  ok('Kein seitliches Scrollen bei 390 px');

  assert.deepEqual(errors, []); ok('Keine JavaScript Fehler');
  await b.close();
  console.log('ALLE ' + n + ' E2E SCHRITTE GRÜN');
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
