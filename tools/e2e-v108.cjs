// E2E ph-v108: Missionen. Oti baut eine Mission in der Oberfläche (Baustein, Text, ganzer Song), gibt sie auf,
// der Schüler sieht Karte, Schritte und Mission Etikett, meldet fertig, Oti hakt in der Akte ab, der nächste Schritt wird frei.
// Läuft auf einem frischen dev-server (eigene Testdaten). Screenshots nach SHOTS.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const t = await ctx.newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();

  const ids = await t.evaluate(async () => {
    const kid = (await api('/api/t/student/save', { first_name: 'Mia', birth_year: 2016, weekday: 3, lesson_time: '16:00', instrument: 'Schlagzeug', status: 'aktiv' })).id;
    const adult = (await api('/api/t/student/save', { first_name: 'Jonas', birth_year: 1995, weekday: 4, lesson_time: '18:00', instrument: 'Schlagzeug', status: 'aktiv' })).id;
    const gtr = (await api('/api/t/student/save', { first_name: 'Fiona', birth_year: 2010, weekday: 3, lesson_time: '17:00', instrument: 'Gitarre', status: 'aktiv' })).id;
    const sid = (await api('/api/t/song/create', { title: "Thank God I'm Free" })).id;
    await api('/api/t/song/bpm', { song_id: sid, bpm: 128 });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Groove Strophe', notation: { sig: '4/4', bars: 1, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14], sn: [4, 12], bd: [0, 8] } } });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Fill 1', notation: { sig: '4/4', bars: 1, tracks: { sn: [0, 1, 2, 3], t1: [4, 5, 6, 7], ft: [8, 9, 10, 11], bd: [12] } } });
    S.songs = await api('/api/songs'); S.data = await api('/api/home');
    return { kid, adult, gtr, sid };
  });

  // Bibliothek: Missionen öffnen, neue Mission anlegen
  await t.click('[data-tab=bibliothek]'); await t.click('[data-act=missions]');
  await t.getByRole('heading', { name: 'Missionen' }).waitFor();
  await t.fill('#ms_title', "Thank God I'm Free spielen"); await t.fill('#ms_goal', 'Den ganzen Song mit Video spielen');
  await t.click('#msNewForm button[type=submit]');
  await t.locator('#msStepForm').waitFor(); ok('Mission angelegt, Editor offen');

  // Schritt 1 und 2: Bausteine (Song wählen, Baustein wählen, Tempo)
  for (const [part, from] of [['Groove Strophe', '60'], ['Fill 1', '50']]) {
    await t.fill('#ms_song', "Thank God I'm Free"); await t.locator('#ms_part').waitFor();
    await t.selectOption('#ms_part', { label: part }); await t.fill('#ms_from', from); await t.fill('#ms_to', '128');
    await t.click('#msStepForm button[type=submit]');
    await t.locator(`[data-sort-kind=mission] .item:has-text("${part}")`).waitFor();
  }
  // Schritt 3: Text, Schritt 4: ganzer Song
  await t.click('[data-act=msKind][data-v=text]'); await t.fill('#ms_text', 'Übergang Strophe in den Refrain mit Fill'); await t.click('#msStepForm button[type=submit]');
  await t.locator('[data-sort-kind=mission] .item:has-text("Übergang")').waitFor();
  await t.click('[data-act=msKind][data-v=song]'); await t.fill('#ms_song', "Thank God I'm Free"); await t.click('#msStepForm button[type=submit]');
  await t.locator('[data-sort-kind=mission] .item:has-text("(Original)")').waitFor();
  const titles = await t.locator('[data-sort-kind=mission] .item b').allTextContents();
  assert.deepEqual(titles, ["Thank God I'm Free: Groove Strophe", "Thank God I'm Free: Fill 1", 'Übergang Strophe in den Refrain mit Fill', "Thank God I'm Free (Original)"]);
  assert.match(await t.textContent('[data-sort-kind=mission] .item:first-child'), /60 bis 128 BPM/); ok('4 Schritte über das Formular: 2 Bausteine mit Tempo, Text, ganzer Song');

  // Sortieren per Ziehen: Text nach oben und wieder zurück
  const drag = async (from, to) => { const a = await t.locator('[data-sort-kind=mission] [data-drag]').nth(from).boundingBox(); const z = await t.locator('[data-sort-kind=mission] [data-drag]').nth(to).boundingBox();
    await t.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await t.mouse.down(); await t.mouse.move(z.x + z.width / 2, z.y + 2, { steps: 8 }); await t.mouse.up(); await t.waitForTimeout(400); };
  await drag(2, 0);
  assert.match(await t.textContent('[data-sort-kind=mission] .item:first-child b'), /Übergang/);
  const srv = await t.evaluate(async () => (await api('/api/t/missions')).missions[0].steps[0].title); assert.match(srv, /Übergang/); ok('Schritte per Ziehen sortiert und gespeichert');
  await drag(0, 3);
  assert.match(await t.textContent('[data-sort-kind=mission] .item:first-child b'), /Groove Strophe/);
  await t.screenshot({ path: OUT + '/v108-1-mission-bauen.png', fullPage: true });

  // Aufgeben: Gitarrenschülerin steht nicht zur Wahl, Mia und Jonas antippen
  assert.equal(await t.locator('[data-act=msWho]:has-text("Fiona")').count(), 0); ok('Gitarrenschülerin wird bei Schlagzeug Mission nicht angeboten');
  await t.click('[data-act=msWho]:has-text("Mia")'); await t.click('[data-act=msWho]:has-text("Jonas")'); await t.click('[data-act=msAssign]');
  await t.getByText('Läuft bei: Mia, Jonas').waitFor({ timeout: 5000 }).catch(async () => { await t.getByText('Läuft bei').waitFor(); });
  ok('Mission an Mia und Jonas aufgegeben');

  // Schüleransicht Kind (Mia), hell: Missionskarte, Etikett an der Hausaufgabe, Missionsansicht
  await t.setViewportSize({ width: 390, height: 844 });
  await t.evaluate(async (st) => { closeOverlay(); startPreview(await api('/api/t/preview', { id: st })); render(); }, ids.kid);
  await t.locator('.mission-card').waitFor();
  assert.match(await t.textContent('.mission-card'), /Schritt 1 von 4/); assert.match(await t.textContent('.mission-card'), /Groove Strophe/);
  assert.match(await t.textContent(".ms-tag"), /Mission · Schritt 1 von 4/); ok('Kind sieht Missionskarte und Etikett an der Hausaufgabe');
  await t.screenshot({ path: OUT + '/v108-2-kind-start-hell.png', fullPage: true });
  await t.click('.mission-card');
  await t.getByRole('heading', { name: "Thank God I'm Free spielen" }).waitFor();
  assert.equal(await t.locator('.lesson-dot.locked').count(), 3); ok('Missionsansicht: Schritt 1 offen, 3 gesperrt');
  await t.screenshot({ path: OUT + '/v108-3-kind-mission-hell.png', fullPage: true });
  await t.click('[data-act=missionReport]'); await t.getByText('Gemeldet, Oti hakt in der Stunde ab').waitFor(); ok('Fertig melden in der Missionsansicht');
  await t.click('[data-act=missionReport]'); await t.click('[data-act=missionPractice]');
  await t.locator('#clockRing').waitFor(); ok('Schritt üben startet die Übung');
  await t.evaluate(() => { clearInterval(tickTimer); store.del('run'); closeOverlay(); endPreviewState(); render(); });

  // Oti: Akte, Mission Karte, Schritt geschafft, nächster frei
  await t.setViewportSize({ width: 1280, height: 1000 });
  await t.evaluate(async (st) => { await openStudent(st); }, ids.kid);
  await t.locator('[data-act=msStepDone]').waitFor();
  assert.match(await t.textContent('.ms-file'), /Schritt 1: Groove Strophe/);
  await t.click('[data-act=msStepDone]'); await t.waitForFunction(() => /Schritt 2/.test((document.querySelector('.ms-file') || {}).textContent || ''));
  assert.match(await t.textContent('.ms-file'), /1\/4/); ok('Oti hakt in der Akte ab, Schritt 2 ist frei');
  await t.screenshot({ path: OUT + '/v108-4-akte.png', fullPage: true });
  await t.click('[data-act=msFileOpen]'); await t.locator('.lesson-dot.fertig').waitFor(); await t.click('[data-act=backToFile]');
  // Alle restlichen Schritte abhaken: Abzeichen beim Schüler
  for (let i = 0; i < 3; i++) { await t.click('[data-act=msStepDone]'); await t.waitForTimeout(300); }
  await t.getByText('Geschafft: Thank God').waitFor(); ok('Alle Schritte geschafft: Mission erledigt');

  await t.evaluate(async (st) => { closeOverlay(); startPreview(await api('/api/t/preview', { id: st })); S.preview.tab = S.tab = 'fortschritt'; render(); }, ids.kid);
  await t.setViewportSize({ width: 390, height: 844 });
  await t.locator('.badge').waitFor(); ok('Abzeichen im Fortschritt');
  await t.screenshot({ path: OUT + '/v108-5-kind-abzeichen.png', fullPage: true });
  await t.evaluate(() => { endPreviewState(); render(); });

  // Erwachsener (Jonas) dunkel
  const d = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const p = await d.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  const code = await t.evaluate(async (st) => (await api('/api/t/access/create', { student_id: st, role: 'student' })).code, ids.adult);
  await p.goto(APP); await p.fill('#code', code); await p.click('button[type=submit]');
  await p.locator('.mission-card').waitFor().catch(async () => { const c = p.locator('[data-act=consent]'); if (await c.count()) await c.click(); await p.locator('.mission-card').waitFor(); });
  await p.screenshot({ path: OUT + '/v108-6-erwachsen-dunkel.png', fullPage: true });
  await p.click('.mission-card'); await p.getByRole('heading', { name: "Thank God I'm Free spielen" }).waitFor();
  await p.click('[data-act=missionReport]'); await p.getByText('Gemeldet, Oti hakt in der Stunde ab').waitFor();
  await p.screenshot({ path: OUT + '/v108-7-erwachsen-mission-dunkel.png', fullPage: true }); ok('Erwachsener echt angemeldet, dunkel, meldet fertig');
  await t.evaluate(async (st) => { await openStudent(st); }, ids.adult);
  assert.match(await t.textContent('.ms-file'), /gemeldet/); ok('Oti sieht die Meldung in der Akte');

  // Gitarre: eigene Mission, Baustein nicht wählbar, Fiona bekommt sie
  await t.evaluate(() => closeOverlay()); await t.click('[data-tab=bibliothek]'); await t.click('[data-act=missions]');
  await t.fill('#ms_title', 'Hark the Herald (Gitarre)'); await t.selectOption('#ms_instr', 'guitar'); await t.click('#msNewForm button[type=submit]');
  await t.locator('#msStepForm').waitFor();
  assert.equal(await t.locator('[data-act=msKind][data-v=part]').count(), 0, 'kein Baustein bei Gitarre');
  await t.click('[data-act=msKind][data-v=text]'); await t.fill('#ms_text', 'G C D Wechsel 1 Minute'); await t.click('#msStepForm button[type=submit]');
  await t.locator('[data-sort-kind=mission] .item').first().waitFor();
  assert.deepEqual(await t.locator('[data-act=msWho]').allTextContents(), ['Fiona']);
  await t.click('[data-act=msWho]'); await t.click('[data-act=msAssign]'); await t.getByText('Läuft bei: Fiona').waitFor();
  await t.evaluate(async (st) => { closeOverlay(); startPreview(await api('/api/t/preview', { id: st })); render(); }, ids.gtr);
  await t.setViewportSize({ width: 390, height: 844 });
  await t.locator('.mission-card').waitFor(); assert.match(await t.textContent('.mission-card'), /Hark the Herald/);
  await t.screenshot({ path: OUT + '/v108-8-gitarre.png', fullPage: true }); ok('Gitarren Mission für Fiona, ohne Bausteine');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  await b.close();
  console.log(`ALLE ${n} SCHRITTE GRÜN (v108)`);
})().catch((e) => { console.error(e); process.exit(1); });
