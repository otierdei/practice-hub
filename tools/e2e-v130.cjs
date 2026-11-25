// E2E ph-v130: Ganzer Song nur mit Video. Song ohne Video zeigt Hinweis und lässt sich nicht aufgeben, mit Video geht es.
const { chromium } = require('playwright');
const APP = 'http://localhost:8080', shots = process.argv[2]; let n = 0;
const ok = (c, m) => { n++; if (!c) { console.error('FEHLER Schritt ' + n + ': ' + m); process.exit(1); } console.log('ok ' + n + ' ' + m); };
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); return { status: r.status, data: await r.json() }; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).data.token;
  const st = (await api(t, '/api/t/student/save', { first_name: 'Vida', instrument: 'Schlagzeug' })).data;
  const sid = st.id || (st.student && st.student.id);
  const noVid = (await api(t, '/api/t/song/create', { title: 'Song ohne Video V130' })).data.id;
  const withVid = (await api(t, '/api/t/song/create', { title: 'Song mit Video V130' })).data.id;
  await api(t, '/api/t/song/links/add', { song_id: withVid, lines: 'Original | https://youtu.be/v130orig001' });
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#8b7a66"/></svg>' }));
  await p.goto(APP); await p.fill('#code', 'LEHRER2345XY'); await p.press('#code', 'Enter');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher' && S.data);
  await p.evaluate(async (id) => { S.songs = await api('/api/songs'); await openLesson(id); }, sid);
  await p.getByText('Hausaufgabe hinzufügen').waitFor();
  await p.fill('#a_song', 'Song ohne Video V130'); await p.waitForSelector('#a_noVideo');
  ok(/kein Video/i.test(await p.textContent('#a_noVideo')), 'Hinweis bei Song ohne Video');
  if (shots) { await p.locator('#a_noVideo').scrollIntoViewIfNeeded(); await p.screenshot({ path: shots + '-kein-video-390.png' }); }
  await p.click('#assignForm button[type=submit]'); await p.waitForTimeout(600);
  const r1 = await p.evaluate((id) => api('/api/t/student', { id }), sid);
  ok(!r1.assignments.some((a) => a.song_id === 'x' || /Song ohne Video V130/.test(a.free_text || '')), 'Song ohne Video nicht aufgegeben');
  await p.fill('#a_song', 'Song mit Video V130'); await p.waitForTimeout(500);
  ok(await p.locator('#a_noVideo').count() === 0, 'kein Hinweis bei Song mit Video');
  await p.click('#assignForm button[type=submit]'); await p.getByText('Song mit Video V130 (Original) aufgegeben').waitFor();
  ok(true, 'Song mit Video aufgegeben');
  ok(!errs.length, 'Keine JavaScript Fehler ' + errs.join(' | '));
  await b.close(); console.log('ALLE ' + n + ' E2E V130 SCHRITTE GRÜN');
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
