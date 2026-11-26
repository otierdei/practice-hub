// Screenshots Kurs Indie Gitarre: Gitarrenschüler mit Kurs Wechsel (390), Lehrer Kursansicht (1440)
const { chromium } = require('playwright'); const fs = require('fs');
const APP = 'http://localhost:8080', out = process.argv[2];
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  await api(t, '/api/t/course/import', JSON.parse(fs.readFileSync('tools/kurse/indie-gitarre.json')));
  const { id } = await api(t, '/api/t/student/save', { first_name: 'Noel', birth_year: 2005, weekday: 3, lesson_time: '16:20', instrument: 'Gitarre' });
  const c = await api(t, '/api/course', { course: 'indie' }); for (const l of c.lessons.slice(0, 2)) await api(t, '/api/t/course/assign', { student_id: id, lesson_id: l.id, status: 'fertig' });
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#8b7a66"/></svg>' }));
  await p.goto(APP + '/#c=' + code); await p.waitForTimeout(1200);
  await p.evaluate(() => { S.overlay = null; }); await p.evaluate(async () => { S.course = await api('/api/course'); openOverlay(courseView); });
  await p.waitForTimeout(300); await p.click('[data-act=courseSwitch][data-v=indie]'); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}-noel-indie-390.png`, fullPage: true });
  const lessonBtn = p.locator('[data-act=courseLesson]').first(); if (await lessonBtn.count()) { await lessonBtn.click(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}-noel-lektion-390.png`, fullPage: true }); }
  const tp = await b.newPage({ viewport: { width: 1440, height: 900 } }); tp.on('pageerror', (e) => errs.push(e.message));
  await tp.goto(APP); await tp.fill('#code', 'LEHRER2345XY'); await tp.press('#code', 'Enter'); await tp.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher');
  await tp.click('nav [data-tab=bibliothek]').catch(() => {}); await tp.waitForTimeout(400); await tp.click('[data-act=course][data-course=guitar]'); await tp.waitForTimeout(300); await tp.click('[data-act=courseSwitch][data-v=indie]'); await tp.waitForTimeout(500);
  await tp.screenshot({ path: `${out}-lehrer-indie-1440.png`, fullPage: true });
  console.log('Fehler:', errs.length ? errs : 'keine'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
