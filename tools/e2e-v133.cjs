// E2E ph-v133 Einstufung in der Stunde, Lücken, Vorschläge nach Stand, Aufstieg, Liedpfad beim Schüler
const { chromium } = require('playwright');
const APP = 'http://localhost:8080', shots = process.argv[2]; let n = 0;
const ok = (c, m) => { n++; if (!c) { console.error('FEHLER Schritt ' + n + ': ' + m); process.exit(1); } console.log('ok ' + n + ' ' + m); };
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); return { status: r.status, data: await r.json() }; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).data.token;
  await api(t, '/api/t/course/import', { course: 'drums', replace: true, levels: [{ level: 1, name: 'Starter' }, { level: 2, name: 'Beat Builder' }, { level: 3, name: 'Groover' }, { level: 4, name: 'Fill Master' }],
    lessons: [{ level: 1, num: 1, title: 'Das Drumset' }, { level: 1, num: 2, title: 'Viertel' }, { level: 2, num: 3, title: 'Rock Beat' }, { level: 2, num: 4, title: '6/8 Groove' }, { level: 3, num: 5, title: 'Achtel Variationen' }, { level: 4, num: 6, title: 'Erste Fills' }] });
  const sid = (await api(t, '/api/t/student/save', { first_name: 'Mara', instrument: 'Schlagzeug' })).data; const id = sid.id || sid.student.id;
  const mk = async (title, level) => { const x = (await api(t, '/api/t/song/create', { title })).data.id; await api(t, '/api/t/song/level', { song_id: x, level }); await api(t, '/api/t/song/links/add', { song_id: x, lines: 'Original | https://youtu.be/' + (title.replace(/\W/g, '') + '00000000000').slice(0, 11) + '\nEasy | https://youtu.be/' + ('e' + title.replace(/\W/g, '') + '00000000000').slice(0, 11) }); return x; };
  const s3 = await mk('Drei Song V133', '3'); const s4 = await mk('Vier Song V133', '4'); await mk('Zwei Song V133', '2a'); await mk('Fuenf Song V133', '5');
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.fill('#code', 'LEHRER2345XY'); await p.press('#code', 'Enter');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher' && S.data);
  await p.evaluate(async (x) => { S.songs = await api('/api/songs'); await openLesson(x); }, id);
  await p.waitForSelector('#einCard'); ok(true, 'Karte Einstufung fehlt noch am Anfang der Stunde');
  if (shots) await p.screenshot({ path: shots + '-karte-390.png' });
  await p.click('[data-act=einLater]'); await p.waitForTimeout(200); ok(await p.locator('#einCard').count() === 0, 'Nächste Stunde blendet sie für heute aus');
  await p.evaluate(() => { store.del('einLater_' + S.file.student.id); openOverlay(lessonView); });
  await p.click('#einCard [data-act=einStart]'); await p.waitForSelector('text=Schritt 1 von 3');
  await p.click(`[data-act=einSong][data-id="${s3}"]`); ok(/Original/.test(await p.textContent(`[data-act=einSong][data-id="${s3}"]`)), 'Song antippen: Original');
  if (shots) await p.screenshot({ path: shots + '-schritt1-390.png' });
  await p.click('[data-act=einNext]'); await p.waitForSelector('#ein_lvl'); ok(await p.inputValue('#ein_lvl') === '3', 'Level aus Songs: 3');
  await p.click('[data-act=einNext]'); await p.waitForSelector('text=Schritt 3 von 3');
  const rows = await p.$$eval('[data-act=einGap]', (x) => x.length); ok(rows === 5, 'Lektionen bis Level 3: ' + rows);
  await p.click('[data-act=einGap] >> nth=3'); ok(await p.getAttribute('[data-act=einGap] >> nth=3', 'aria-pressed') === 'false', '6/8 Groove als Lücke markiert');
  if (shots) await p.screenshot({ path: shots + '-schritt3-390.png' });
  await p.click('[data-act=einSave]'); await p.waitForSelector('#lvlBadge');
  ok(/Level 3 · Groover · von dir/.test(await p.textContent('#lvlBadge')) && await p.locator('#einCard').count() === 0, 'Gespeichert: Level 3, Karte weg');
  await p.evaluate(() => { const d = document.querySelector('#sugBox'); if (d) d.open = true; });
  const sug = await p.textContent('#sugBox'); ok(/Lücke · Lektion 4: 6\/8 Groove/.test(sug) && /Erste Fills/.test(sug) && /Vier Song V133/.test(sug), 'Vorschläge: Lücke zuerst, nächste Lektion, Song eins drüber');
  ok(sug.indexOf('Lücke') < sug.indexOf('Erste Fills'), 'Lücke steht vor der nächsten Lektion (Level 4)');
  if (shots) await p.screenshot({ path: shots + '-vorschlaege-390.png', fullPage: true });
  // Aufstieg: Song Level 4 abgeschlossen
  await p.waitForTimeout(1100);
  const a = (await api(t, '/api/t/assignments/new', { student_id: id, items: [{ song_id: s4, version: 'Original' }] })).data.ids[0];
  await api(t, '/api/t/assignment/status', { id: a, status: 'erledigt' });
  await p.evaluate(async (x) => { await openLesson(x); }, id); await p.waitForSelector('#upCard');
  ok(/Aufstieg auf Level 4/.test(await p.textContent('#upCard')), 'Aufstieg vorgeschlagen nach Level 4 Song');
  if (shots) await p.screenshot({ path: shots + '-aufstieg-390.png' });
  await p.click('[data-act=upYes]'); await p.waitForFunction(() => S.file.level_set.level === '4'); ok(await p.locator('#upCard').count() === 0, 'Aufstieg bestätigt, Karte weg');
  // Schüler Liedpfad (Darstellung)
  const html = await p.evaluate(() => { const old = S.data; S.data = { level: '3', student: { instrument: 'Schlagzeug' } }; S.course = S.file.course; const h = pathBox(); S.data = old; return h; });
  ok(/Dein Liedpfad/.test(html) && /Gesperrt · Vier Song V133/.test(html) && /Dafür fehlt dir noch/.test(html), 'Schüler sieht nächstes Level gesperrt mit fehlenden Lektionen');
  ok(!errs.length, 'Keine JavaScript Fehler ' + errs.join(' | '));
  await b.close(); console.log('ALLE ' + n + ' E2E V133 SCHRITTE GRÜN');
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
