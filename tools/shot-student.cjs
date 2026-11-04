// Screenshot der Schüleransicht mit Demodaten (keine echten Schülerdaten)
const { chromium } = require('playwright');
const APP = 'http://localhost:8080';
const out = process.argv[2] || 'shot';
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY', device: 'shot' })).token;
  const { id } = await api(t, '/api/t/student/save', { first_name: 'Max', weekday: 3, lesson_time: '16:20', lesson_minutes: 40, instrument: 'Schlagzeug' });
  const ex1 = await api(t, '/api/t/exercise/save', { title: 'Paradiddle Groove', category: 'Technik', source_type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', target_bpm: 90 });
  const ex2 = await api(t, '/api/t/exercise/save', { title: 'Song: Way Maker Intro', category: 'Song', source_type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  await api(t, '/api/t/lesson/finish', { student_id: id, minutes: 40, notes_shared: 'Gut gemacht. Achte auf lockere Handgelenke.', new_assignments: [{ exercise_id: ex1.id, target_bpm: 90, start_bpm: 70, minutes_per_day: 10 }, { exercise_id: ex2.id, minutes_per_day: 10 }, { free_text: 'Ghost Notes auf der Snare, ganz leise', minutes_per_day: 5 }, { free_text: 'Rudiment: Single Stroke Roll', url: 'youtu.be/dQw4w9WgXcQ', minutes_per_day: 5 }] });
  const file = await api(t, '/api/t/student', { id });
  const ghost = file.assignments.find((a) => /Ghost/.test(a.free_text || ''));
  const linked = await api(t, '/api/t/assignment/link', { id: ghost.id, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const prev = await api(t, '/api/t/preview', { id });
  console.log('link', linked.url, 'preview tasks with url', prev.assignments.filter((a) => a.url).length, 'of', prev.assignments.length);
  const lib = await api(t, '/api/t/exercises'); console.log('library', lib.exercises.map((e) => e.title).join(', '));
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // Ohne Internet: YouTube Vorschaubilder durch einen beschrifteten Platzhalter ersetzen
  await p.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#6b4f3a"/><stop offset="1" stop-color="#2b2f22"/></linearGradient></defs><rect width="480" height="270" fill="url(#g)"/><text x="16" y="250" fill="#fff" font-family="sans-serif" font-size="26">YouTube Vorschaubild</text></svg>' }));
  await p.goto(APP + '/#c=' + code); await p.waitForTimeout(1500);
  const consent = p.getByRole('button', { name: /zustimm|Einverstanden|Weiter/i }).first();
  if (await consent.count()) { await consent.click().catch(() => {}); await p.waitForTimeout(800); }
  await p.screenshot({ path: out + '-home.png', fullPage: true });
  if (process.argv[3]) {
    await p.click('.tile[data-act="metroOpen"]'); await p.waitForTimeout(400);
    await p.check('#ma_on'); await p.fill('#ma_bars', '1'); await p.fill('#ma_add', '10'); await p.fill('#ma_max', '100'); await p.locator('#ma_max').dispatchEvent('change');
    await p.click('[data-act=metronome]'); await p.waitForTimeout(3500);
    const bpm = await p.textContent('#bpmVal'); console.log('BPM nach 3,5 s (1 Takt bei 80 = 3 s):', bpm);
    if (bpm !== '90') throw new Error('Automatik hat nicht erhöht: ' + bpm);
    await p.waitForTimeout(6000); const bpm2 = await p.textContent('#bpmVal'); console.log('nach weiteren 6 s:', bpm2, await p.textContent('#maInfo'));
    if (bpm2 !== '100') throw new Error('Obergrenze falsch: ' + bpm2);
    await p.screenshot({ path: out + '-metronom.png' });
    await p.click('[data-act="closeMetro"]'); await p.click('.task [data-act="practice"]'); await p.waitForTimeout(1600);
    await p.screenshot({ path: out + '-ueben.png' });
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
