// Screenshots Songs: Lehrer gleicht ab, Schüler im Lobpreis sieht Sonntag, baut Setlist, öffnet Song mit Bausteinen
const { chromium } = require('playwright');
const APP = 'http://localhost:8080', out = process.argv[2];
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  const { id } = await api(t, '/api/t/student/save', { first_name: 'Max', weekday: 3, lesson_time: '16:20', instrument: 'Schlagzeug' });
  const sync = await api(t, '/api/t/songs/sync'); console.log('sync', JSON.stringify(sync));
  await api(t, '/api/t/student/worship', { id, on: true });
  const home = await api(t, '/api/songs'); const sieg = home.songs.find((x) => /Sieg/.test(x.title));
  for (const [ti, n] of [['Groove Vers', 'Hi Hat Achtel, Bassdrum auf 1 und 3'], ['Groove Chorus', 'Ride offen'], ['Fill in den Chorus', '']]) await api(t, '/api/t/song/part/save', { song_id: sieg.id, title: ti, url: 'https://youtu.be/dQw4w9WgXcQ', notes: n });
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#6b4f3a"/><text x="16" y="250" fill="#fff" font-family="sans-serif" font-size="26">YouTube Vorschaubild</text></svg>' }));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/#c=' + code); await p.getByText('Setlist Gottesdienst').first().waitFor();
  await p.screenshot({ path: out + '-home.png' });
  await p.click('nav [data-tab=songs]'); await p.waitForTimeout(300);
  await p.click('#songList [data-act=mySong] >> nth=1'); await p.waitForTimeout(300);
  await p.fill('#songQ', 'all'); await p.waitForTimeout(200);
  await p.screenshot({ path: out + '-songs.png', fullPage: true });
  await p.click('.card.sunday [data-act=song] >> nth=0'); await p.getByText('Bausteine').waitFor();
  await p.screenshot({ path: out + '-song.png', fullPage: true });
  const mine = (await api((await p.evaluate(() => JSON.parse(localStorage.getItem('ph_token')))), '/api/songs')).mine.length;
  console.log('meine Setlist:', mine, 'Fehler:', errs.length ? errs : 'keine');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
