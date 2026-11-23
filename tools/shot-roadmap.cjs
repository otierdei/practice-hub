// Screenshots Roadmap Player: Gitarrenschüler (390, hell und dunkel) und Lehrer (1440), Song aus tools/ireal/jazz-einstieg.json
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'http://localhost:8080', out = process.argv[2];
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  const data = JSON.parse(fs.readFileSync('tools/ireal/jazz-einstieg.json'));
  const ids = {};
  for (const s of data) { const { id } = await api(t, '/api/t/song/create', { title: s.title }); ids[s.title] = id; await api(t, '/api/t/song/roadmap', { song_id: id, roadmap: s.roadmap }); await api(t, '/api/t/song/teaching', { song_id: id, state: 'on', kind: 'jazz' }); }
  // Worship Beispiel mit Drum Marken
  const { id: wid } = await api(t, '/api/t/song/create', { title: 'Worship Beispiel' }); ids.w = wid;
  await api(t, '/api/t/song/roadmap', { song_id: wid, roadmap: { sig: '4/4', bpm: 72, key: 'B', style: 'Worship Ballade', sections: [
    { id: 'i', type: 'intro', bars: [{ c: ['B'] }, { c: ['E'] }, { c: ['G#m7'] }, { c: ['F#'], m: ['fill'] }] },
    { id: 'v', type: 'verse', bars: [{ c: ['B'] }, { c: ['E'] }, { c: ['G#m7'] }, { c: ['F#'] }, { c: ['B'] }, { c: ['E'] }, { c: ['G#m7', 'F#'] }, { c: ['E'], m: ['build'] }] },
    { id: 'c', type: 'chorus', bars: [{ c: ['E'], m: ['crash'] }, { c: ['B/D#'] }, { c: ['G#m7'] }, { c: ['F#'] }, { c: ['E'] }, { c: ['B/D#'] }, { c: ['F#'], m: ['hit'], t: 'alle auf 1' }, { c: ['F#'], m: ['stop'] }] },
  ], order: [{ s: 'i', x: 1 }, { s: 'v', x: 1, dyn: 'p' }, { s: 'c', x: 1 }, { s: 'v', x: 1, dyn: 'mf' }, { s: 'c', x: 2, dyn: 'f', note: 'zweites Mal voll' }] } });
  const { id: sid } = await api(t, '/api/t/student/save', { first_name: 'Noel', weekday: 3, lesson_time: '16:20', instrument: 'Gitarre', birth_year: 2005 });
  const { code } = await api(t, '/api/t/access/create', { student_id: sid, role: 'student' });
  const b = await chromium.launch(); const errs = [];
  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme }); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/#c=' + code); await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'student');
    await p.evaluate(async (id) => { S.songs = await api('/api/songs'); await openSong(id); }, ids['Blue Moon']);
    await p.waitForTimeout(300); await p.screenshot({ path: `${out}-song-390-${scheme}.png`, fullPage: true });
    await p.click('[data-act=rmOpen]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}-gitarre-390-${scheme}.png`, fullPage: true });
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/#c=' + code); await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'student');
  await p.evaluate(async (id) => { S.songs = await api('/api/songs'); await openSong(id); }, ids.w);
  await p.click('[data-act=rmOpen]'); await p.click('[data-act=rmView][data-v=drums]'); await p.click('[data-act=rmLoop][data-v="2"]');
  await p.evaluate(() => { S.rm.cur = 12; rmRefreshBars(); });
  await p.screenshot({ path: `${out}-drums-390.png`, fullPage: true });
  await p.click('[data-act=rmView][data-v=guitar]'); await p.click('#rmOpts summary'); await p.click('[data-act=rmCapo] >> nth=1');
  await p.screenshot({ path: `${out}-capo-390.png`, fullPage: true });
  const tp = await b.newPage({ viewport: { width: 1440, height: 900 } }); tp.on('pageerror', (e) => errs.push(e.message));
  await tp.goto(APP); await tp.fill('#code', 'LEHRER2345XY'); await tp.press('#code', 'Enter'); await tp.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher');
  await tp.click('nav [data-tab=songs]'); await tp.click('[data-act=songLang][data-v=unterricht]'); await tp.click('[data-act=songKind][data-v=jazz]'); await tp.locator('#rmPlBox summary').click();
  await tp.screenshot({ path: `${out}-songs-1440.png`, fullPage: true });
  await tp.evaluate(async (id) => { await openSong(id); }, ids['Fly Me To The Moon']); await tp.click('[data-act=rmOpen]'); await tp.click('[data-act=rmView][data-v=guitar]');
  await tp.screenshot({ path: `${out}-player-1440.png`, fullPage: true });
  console.log('Fehler:', errs.length ? errs : 'keine');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
