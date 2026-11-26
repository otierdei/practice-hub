// E2E ph-v134 Kurs Funk Gitarre: Gitarrenschüler wechselt Gitarre / Indie / Funk, Lehrer öffnet Funk Kurs in der Bibliothek. Mit Ordner als Argument auch Screenshots.
const { chromium } = require('playwright'); const fs = require('fs');
const APP = 'http://localhost:8080', out = process.argv[2]; let n = 0;
const ok = (c, m) => { n++; if (!c) { console.error('FEHLER Schritt ' + n + ': ' + m); process.exit(1); } console.log('ok ' + n + ' ' + m); };
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  for (const k of ['indie', 'funk']) { const d = JSON.parse(fs.readFileSync(`tools/kurse/${k}-gitarre.json`)); const have = await api(t, '/api/course', { course: k }); if (!have.lessons.length) await api(t, '/api/t/course/import', d); }
  const { id } = await api(t, '/api/t/student/save', { first_name: 'Funky', birth_year: 2004, weekday: 4, lesson_time: '18:00', instrument: 'Gitarre' });
  const c = await api(t, '/api/course', { course: 'funk' });
  ok(c.lessons.length === 17 && c.levels.length === 6, 'Funk Kurs importiert: 6 Level, 17 Lektionen');
  await api(t, '/api/t/course/assign', { student_id: id, lesson_id: c.lessons[0].id, status: 'fertig' });
  await api(t, '/api/t/course/assign', { student_id: id, lesson_id: c.lessons[1].id, status: 'offen' });
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const b = await chromium.launch(); const errs = [];
  const yt = (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#8b7a66"/></svg>' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message)); await p.route('https://i.ytimg.com/**', yt);
  await p.goto(APP + '/#c=' + code); await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'student' && S.data && S.course, null, { timeout: 8000 });
  ok(await p.evaluate(() => S.course && S.course.course) === 'funk', 'Schüler nur mit Funk Lektionen startet im Funk Kurs');
  await p.evaluate(() => { S.overlay = null; openOverlay(courseView); }); await p.waitForTimeout(300);
  const chips = await p.locator('[data-act=courseSwitch]').allTextContents();
  ok(chips.join('|') === 'Grundkurs|Indie|Funk' && /Gitarre/.test(await p.textContent('.sheet')), 'Reiter Gitarre mit Unterkursen Grundkurs, Indie, Funk');
  ok(await p.locator('[data-act=courseSwitch][data-v=funk][aria-pressed=true]').count() === 1, 'Funk ist ausgewählt');
  ok(/Funk Starter/.test(await p.textContent('body')), 'Level 1 heißt Funk Starter');
  if (out) await p.screenshot({ path: `${out}-schueler-funk-390.png`, fullPage: true });
  await p.click('[data-act=courseSwitch][data-v=indie]'); await p.waitForTimeout(400);
  ok(/Indie Starter/.test(await p.textContent('body')), 'Wechsel zu Indie klappt');
  await p.click('[data-act=courseSwitch][data-v=funk]'); await p.waitForTimeout(400);
  ok(/Funk Starter/.test(await p.textContent('body')), 'zurück zu Funk');
  const lessonBtn = p.locator('.sheet [data-act=courseLesson]').first();
  if (await lessonBtn.count()) { await lessonBtn.click(); await p.waitForTimeout(400); ok(/16tel/.test(await p.textContent('body')), 'Lektion 1.1 öffnet mit Inhalt'); if (out) await p.screenshot({ path: `${out}-schueler-lektion-390.png`, fullPage: true }); }
  ok(!/Lehrer Hinweis/.test(await p.textContent('body')), 'Schüler sieht keinen Lehrer Hinweis');
  const tp = await b.newPage({ viewport: { width: 1440, height: 900 } }); tp.on('pageerror', (e) => errs.push(e.message)); await tp.route('https://i.ytimg.com/**', yt);
  await tp.goto(APP); await tp.fill('#code', 'LEHRER2345XY'); await tp.press('#code', 'Enter'); await tp.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher' && S.data);
  await tp.click('nav [data-tab=bibliothek]').catch(() => {}); await tp.waitForTimeout(400);
  ok(await tp.locator('[data-act=course]').allTextContents().then((t) => t.join('|')) === 'Gitarre|Drums', 'Bibliothek hat nur zwei Knöpfe: Gitarre und Drums');
  await tp.click('[data-act=course][data-course=drums]'); await tp.waitForTimeout(400);
  ok(await tp.locator('[data-act=courseSwitch]').count() === 0, 'Drums ohne Unterkurs Chips (nur Grundkurs)');
  await tp.click('[data-act=courseBack]').catch(() => {}); await tp.waitForTimeout(300);
  await tp.click('[data-act=course][data-course=guitar]'); await tp.waitForTimeout(400);
  ok((await tp.locator('[data-act=courseSwitch]').allTextContents()).join('|') === 'Grundkurs|Indie|Funk', 'Gitarre zeigt Unterkurse');
  await tp.click('[data-act=courseSwitch][data-v=funk]'); await tp.waitForTimeout(500);
  const body = await tp.textContent('body');
  ok(/Funk Starter/.test(body) && /Sound und Projekt/.test(body) && /Get Lucky/.test(body), 'Lehreransicht zeigt alle Level und Songs');
  if (out) await tp.screenshot({ path: `${out}-lehrer-funk-1440.png`, fullPage: true });
  ok(!errs.length, 'keine Konsolenfehler ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
