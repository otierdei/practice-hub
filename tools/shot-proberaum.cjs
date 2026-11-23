// Screenshots Proberaum Muster: Startseite Schüler (Jugendlicher und Kind), 390 hell und dunkel, 1440
const { chromium } = require('playwright');
const APP = 'http://localhost:8080', out = process.argv[2];
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  const ex1 = await api(t, '/api/t/exercise/save', { title: 'Paradiddle Groove', category: 'Technik', source_type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', target_bpm: 90 });
  const codes = {};
  // Kurs mit 3 Leveln für die Weg Karte
  const lessonIds = [];
  for (const [nm, n] of [['Starter', 3], ['Beat Builder', 4], ['Groover', 4]]) { const { level } = await api(t, '/api/t/course/level/add', { course: 'drums', name: nm }); for (let i = 0; i < n; i++) lessonIds.push((await api(t, '/api/t/course/lesson/add', { course: 'drums', level, title: nm + ' Lektion ' + (i + 1) })).id); }
  for (const [name, by] of [['Lena', 2005], ['Max', 2016]]) {
    const { id } = await api(t, '/api/t/student/save', { first_name: name, birth_year: by, weekday: 3, lesson_time: '16:20', instrument: 'Schlagzeug' });
    await api(t, '/api/t/lesson/finish', { student_id: id, minutes: 40, new_assignments: [{ exercise_id: ex1.id, target_bpm: 90, start_bpm: 70, minutes_per_day: 10 }, { free_text: 'Way Maker: Groove Strophe', url: 'https://youtu.be/dQw4w9WgXcQ', minutes_per_day: 10 }, { free_text: 'Ghost Notes ganz leise', minutes_per_day: 5 }, { free_text: 'Single Stroke Roll', minutes_per_day: 5 }] });
    await api(t, '/api/t/consent', { student_id: id, how: 'liegt Oti vor' }).catch(() => {});
    for (const lid of lessonIds.slice(0, 5)) await api(t, '/api/t/course/assign', { student_id: id, lesson_id: lid, status: 'fertig' });
    const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' }); codes[name] = code;
    const tok = (await api(null, '/api/login', { code })).token;
    // Übezeiten: diese Woche 2 Tage, die 3 Wochen davor je 3 Tage
    const base = new Date(); const dow = (base.getDay() + 6) % 7; const mon = new Date(base); mon.setDate(base.getDate() - dow);
    const offs = [0, 1, -7, -6, -5, -14, -13, -11, -21, -20, -18];
    for (const o of offs) { const d = new Date(mon); d.setDate(mon.getDate() + o); if (d > base) continue; const ld = d.toISOString().slice(0, 10); await api(tok, '/api/session/add', { client_id: name + o, seconds: 900, local_date: ld, started_at: d.toISOString(), ended_at: new Date(d.getTime() + 900000).toISOString() }); }
  }
  const b = await chromium.launch(); const errs = [];
  const thumb = (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#6b5a44"/><circle cx="240" cy="135" r="60" fill="#8a7458"/><text x="20" y="250" fill="#f3efe6" font-family="sans-serif" font-size="24">Video</text></svg>' });
  for (const [name, w, h, scheme] of [['Lena', 390, 844, 'light'], ['Lena', 390, 844, 'dark'], ['Max', 390, 844, 'light'], ['Lena', 1440, 900, 'light']]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, colorScheme: scheme }); p.on('pageerror', (e) => errs.push(e.message));
    await p.route('https://i.ytimg.com/**', thumb);
    await p.goto(APP + '/#c=' + codes[name]); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}-${name}-${w}-${scheme}.png`, fullPage: true });
    await p.click('nav [data-tab=fortschritt]'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}-${name}-${w}-${scheme}-fortschritt.png`, fullPage: true }); await p.close();
  }
  const tp = await b.newPage({ viewport: { width: 1440, height: 900 } }); tp.on('pageerror', (e) => errs.push(e.message));
  await tp.goto(APP); await tp.fill('#code', 'LEHRER2345XY'); await tp.press('#code', 'Enter'); await tp.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher');
  await tp.evaluate(async () => { const st = (await api('/api/home')).students.find((x) => x.first_name === 'Lena'); await openStudent(st.id); });
  await tp.waitForTimeout(600); await tp.click('[data-act=streakDays][data-v="2"]'); await tp.waitForTimeout(500);
  await tp.screenshot({ path: `${out}-akte-1440.png`, fullPage: true });
  console.log('Fehler:', errs.length ? errs : 'keine'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
