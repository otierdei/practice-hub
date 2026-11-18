// E2E ph-v107: Gitarre ohne Schlagzeug, Playthrough und Tutorial beim Aufgeben und in der Hausaufgabe,
// Mitspielen mit Einzählen und Gitarren Samples. Läuft auf einem frischen dev-server (eigene Testdaten).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8080/';
const OUT = process.env.SHOTS || '.';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const t = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();

  const ids = await t.evaluate(async () => {
    const st = (await api('/api/t/student/save', { first_name: 'Gita', weekday: 3, lesson_time: '17:00', lesson_minutes: 40, instrument: 'Gitarre', status: 'aktiv' })).id;
    const sid = (await api('/api/t/song/create', { title: 'Gitarren Song' })).id;
    await api('/api/t/song/links/add', { song_id: sid, version: 'Original', instrument: 'drums', lines: 'Original | https://youtu.be/AAAAAAAAAAA' });
    await api('/api/t/song/links/add', { song_id: sid, version: 'Playthrough', instrument: 'guitar', lines: 'Playthrough | https://youtu.be/BBBBBBBBBBB\nTutorial | https://youtu.be/CCCCCCCCCCC' });
    await api('/api/t/song/part/save', { song_id: sid, title: 'Drum Baustein', url: 'https://youtu.be/DDDDDDDDDDD' });
    const g = Guitar.empty(); g.chords = []; g.scale = { type: 'chrom', pos: 1 };
    const ex = (await api('/api/t/exercise/save', { title: 'Chromatische Fingerübung Test', category: 'Gitarre', notation: g, target_bpm: 60 })).id;
    S.songs = await api('/api/songs');
    return { st, sid, ex };
  });

  // Stunde: kein Versionsfeld, beim Song nur die Gitarrenvideos
  await t.evaluate(async (st) => { await openLesson(st); }, ids.st);
  await t.locator('#a_song').waitFor();
  assert.equal(await t.locator('#a_ver').count(), 0, 'kein Versionsfeld bei Gitarre'); ok('Kein Schlagzeug Versionsfeld beim Aufgeben');
  await t.fill('#a_song', 'Gitarren Song'); await t.locator('#a_partBox .gt-vid').first().waitFor();
  const vids = await t.locator('#a_partBox .gt-vid b').allTextContents();
  assert.deepEqual(vids, ['Playthrough', 'Tutorial']); assert.equal(await t.locator('#a_part').count(), 0, 'keine Bausteine'); ok('Beim Aufgeben: Playthrough und Tutorial, keine Bausteine');
  await t.locator('#a_partBox').screenshot({ path: OUT + '/v107-1-aufgeben.png' });

  // Hausaufgabe anlegen und ansehen
  await t.evaluate(async ({ st, sid, ex }) => { await api('/api/t/assignments/new', { student_id: st, items: [{ song_id: sid, version: null, minutes_per_day: 10 }, { exercise_id: ex, start_bpm: 50, target_bpm: 60, minutes_per_day: 5 }] }); S.file = await api('/api/t/student', { id: st }); const a = S.file.assignments.find((x) => x.song_id === sid); S.asgId = a.id; await loadSongFor(a); openOverlay(assignmentDetailView); }, ids);
  await t.locator('.yt iframe').first().waitFor();
  const srcs = await t.locator('.yt iframe').evaluateAll((els) => els.map((e) => e.src));
  assert.equal(srcs.length, 2); assert.ok(srcs[0].includes('BBBBBBBBBBB') && srcs[1].includes('CCCCCCCCCCC'), 'beide Gitarrenvideos'); assert.ok(!srcs.some((x) => /AAAAAAAAAAA|DDDDDDDDDDD/.test(x)), 'kein Schlagzeug Video');
  assert.equal(await t.getByText('Bausteine').count(), 0); ok('Hausaufgabe beim Lehrer: beide Gitarrenvideos, nichts vom Schlagzeug');
  await t.screenshot({ path: OUT + '/v107-2-hausaufgabe-lehrer.png', fullPage: true });

  // Song beim Lehrer, Gitarre gewählt: Bausteine ausgeblendet, Versionen Playthrough und Tutorial beim Hinzufügen
  await t.evaluate(async (sid) => { S.songInstrPick = 'guitar'; await openSong(sid); S.songInstrPick = 'guitar'; openOverlay(songView); }, ids.sid);
  assert.equal(await t.locator('section.hidden h2:has-text("Bausteine")').count(), 1, 'Bausteine bei Gitarre ausgeblendet'); ok('Song mit Gitarre: Bausteine ausgeblendet');
  await t.evaluate(() => { S.songInstrPick = null; closeOverlay(); });

  // Schüleransicht: Song Hausaufgabe üben zeigt beide Videos; Fingerübung Mitspielen mit Einzählen
  await t.setViewportSize({ width: 390, height: 844 });
  await t.evaluate(async (st) => { startPreview(await api('/api/t/preview', { id: st })); render(); }, ids.st);
  await t.evaluate(async (sid) => { const a = stuData().assignments.find((x) => x.song_id === sid); await goTask(a.id); }, ids.sid);
  await t.locator('#clockRing').waitFor(); await t.locator('.yt iframe').nth(1).waitFor();
  assert.equal(await t.locator('.yt iframe').count(), 2); ok('Schüler übt Song: Playthrough und Tutorial sichtbar');
  await t.screenshot({ path: OUT + '/v107-3-schueler-song.png', fullPage: true });
  await t.evaluate(() => { clearInterval(tickTimer); store.del('run'); closeOverlay(); });
  await t.evaluate(async (ex) => { const a = stuData().assignments.find((x) => x.exercise_id === ex); await goTask(a.id); }, ids.ex);
  await t.locator('[data-act=gtPlay][data-mode=scale]').waitFor();
  assert.match(await t.textContent('[data-act=gtPlay][data-mode=scale]'), /Mitspielen/); ok('Fingerübung hat Mitspielen');
  await t.click('[data-act=gtPlay][data-mode=scale]');
  await t.waitForFunction(() => document.querySelector('#gtCount') && /[1-4]/.test(document.querySelector('#gtCount').textContent), null, { timeout: 4000 }); ok('Einzählen sichtbar');
  await t.screenshot({ path: OUT + '/v107-4-mitspielen-einzaehlen.png' });
  await t.waitForFunction(() => Guitar.isPlaying() && !document.querySelector('#gtCount').textContent && document.querySelector('.gt-sdot.on'), null, { timeout: 8000 }); ok('Nach dem Einzählen läuft die Übung mit Cursor');
  const sm = await t.evaluate(async () => { const r = await fetch('samples/gtr/E2.mp3?v=1'); return r.status; });
  assert.equal(sm, 200); assert.equal(await t.evaluate(() => Guitar.samplesLoaded()), 12, 'alle 12 Samples dekodiert'); ok('Gitarren Samples geladen und dekodiert');
  await t.screenshot({ path: OUT + '/v107-5-mitspielen-laeuft.png' });
  await t.evaluate(() => { Guitar.stop(); clearInterval(tickTimer); store.del('run'); closeOverlay(); });

  assert.deepEqual(errors, []); console.log('ALLE ' + n + ' SCHRITTE GRÜN (v107)');
  await b.close();
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
