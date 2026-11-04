// Screenshots Kurs: Lehrer importiert Gerüst (Datei aus Argument), gibt Lektion auf, Schüler sieht Weg und Lektion
const { chromium } = require('playwright'); const fs = require('fs');
const APP = 'http://localhost:8080', seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), out = process.argv[3];
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  await api(t, '/api/t/songs/sync');
  console.log('import', JSON.stringify(await api(t, '/api/t/course/import', seed)));
  const { id } = await api(t, '/api/t/student/save', { first_name: 'Max', weekday: 3, lesson_time: '16:20' });
  const c = await api(t, '/api/course', { student_id: id });
  for (const l of c.lessons.slice(0, 5)) await api(t, '/api/t/course/assign', { student_id: id, lesson_id: l.id, status: 'fertig' });
  const l7 = c.lessons.find((l) => l.num === 7); await api(t, '/api/t/course/assign', { student_id: id, lesson_id: c.lessons.find((l) => l.num === 6).id, status: 'offen' });
  await api(t, '/api/t/course/item/save', { lesson_id: l7.id, kind: 'video', title: 'Fill 1 langsam erklärt', url: 'https://youtu.be/dQw4w9WgXcQ' });
  await api(t, '/api/t/course/assign', { student_id: id, lesson_id: l7.id, status: 'offen' });
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/#c=' + code); await p.locator('.level-card').waitFor();
  await p.screenshot({ path: out + '-home.png', fullPage: true });
  await p.click('.level-card'); await p.waitForTimeout(300); await p.screenshot({ path: out + '-weg.png', fullPage: true });
  await p.click('.sheet [data-act=courseLesson][data-id="' + l7.id + '"]'); await p.waitForTimeout(400); await p.screenshot({ path: out + '-lektion.png', fullPage: true });
  console.log('Level Karte:', (await p.textContent('.pill')).trim(), '| Fehler:', errs.length ? errs : 'keine');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
