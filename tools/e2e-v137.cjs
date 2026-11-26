// E2E ph-v137 Kurs direkt in der Stunde: Unterkurs wählen, Lektion aufgeben, ganzen Kurs als Weg, nach Geschafft automatisch die nächste. Mit Ordner als Argument auch Screenshots.
const { chromium } = require('playwright'); const fs = require('fs');
const APP = 'http://localhost:8080', out = process.argv[2]; let n = 0;
const ok = (c, m) => { n++; if (!c) { console.error('FEHLER Schritt ' + n + ': ' + m); process.exit(1); } console.log('ok ' + n + ' ' + m); };
(async () => {
  const api = async (tok, p, b) => { const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b || {}) }); return r.json(); };
  const t = (await api(null, '/api/login', { code: 'LEHRER2345XY' })).token;
  for (const k of ['indie', 'funk']) { const have = await api(t, '/api/course', { course: k }); if (!have.lessons.length) await api(t, '/api/t/course/import', JSON.parse(fs.readFileSync(`tools/kurse/${k}-gitarre.json`))); }
  const r = await api(t, '/api/t/student/save', { first_name: 'Pala', birth_year: 2006, weekday: 4, lesson_time: '17:00', instrument: 'Gitarre' }); const id = r.id || r.student.id;
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.fill('#code', 'LEHRER2345XY'); await p.press('#code', 'Enter');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.role === 'teacher' && S.data);
  await p.evaluate(async (x) => { S.songs = await api('/api/songs'); await openLesson(x); store.set('einLater_' + x, localDate(new Date())); openOverlay(lessonView); }, id);
  await p.waitForSelector('#lessonCourse'); ok(await p.evaluate(() => { const k = document.getElementById('lessonCourse'), h = document.querySelector('.lesson-grid'); return k.getBoundingClientRect().top < h.getBoundingClientRect().top; }), 'Kurs Karte oben in der Stunde, über den Hausaufgaben');
  await p.click('#lessonCourse summary'); await p.waitForTimeout(200);
  ok((await p.locator('#lessonCourse [data-act=lcSwitch]').allTextContents()).join('|') === 'Grundkurs|Indie|Funk', 'Chips Grundkurs, Indie, Funk');
  await p.click('#lessonCourse [data-act=lcSwitch][data-v=funk]'); await p.waitForTimeout(400);
  ok(/Kurs · Funk Gitarre/.test(await p.textContent('#lessonCourse')), 'Funk gewählt, ohne die Stunde zu verlassen');
  ok(await p.evaluate(() => S.overlay === lessonView), 'immer noch in der Stunde');
  // Einzelne Lektion aufgeben (Level 2, 1. Lektion)
  const l21 = await p.evaluate(() => S.file.course.lessons.find((l) => l.level === 2 && l.num === 1).id);
  await p.evaluate(() => { for (const d of document.querySelectorAll('#lessonCourse details')) d.open = true; });
  await p.click(`#lessonCourse [data-act=lcState][data-id="${l21}"]`); await p.waitForTimeout(400);
  ok(await p.evaluate((x) => S.file.course.progress[x] && S.file.course.progress[x].status, l21) === 'offen', 'Einzelne Lektion 2.1 aufgegeben');
  // Ganzen Kurs als Weg
  await p.click('#lessonCourse [data-act=lcPath][data-v=funk]'); await p.waitForTimeout(500);
  const c = await p.evaluate(() => S.file.course); const l11 = c.lessons.find((l) => l.level === 1 && l.num === 1).id, l12 = c.lessons.find((l) => l.level === 1 && l.num === 2).id;
  ok(c.path === 'funk' && /Läuft als Weg/.test(await p.textContent('#lessonCourse')), 'Ganzer Kurs läuft als Weg');
  ok(c.progress[l11] && c.progress[l11].status === 'offen', 'Lektion 1.1 automatisch aufgegeben');
  if (out) await p.screenshot({ path: `${out}-stunde-kurs-1440.png` });
  await p.click(`#lessonCourse [data-act=lcState][data-id="${l11}"]`); await p.waitForTimeout(500);
  const c2 = await p.evaluate(() => S.file.course);
  ok(c2.progress[l11].status === 'fertig', '1.1 geschafft');
  ok(c2.progress[l12] && c2.progress[l12].status === 'offen', 'Lektion 1.2 automatisch aufgegeben');
  await p.evaluate(() => { for (const d of document.querySelectorAll('#lessonCourse details')) d.open = true; });
  await p.click(`#lessonCourse [data-act=lcState][data-id="${l21}"]`); await p.waitForTimeout(500);
  const c3 = await p.evaluate(() => S.file.course);
  ok(c3.progress[l21].status === 'fertig' && Object.values(c3.progress).filter((x) => x.status === 'offen').length === 1, 'Extra Lektion 2.1 geschafft, nichts doppelt aufgegeben');
  // Schüler sieht es in Dein Weg
  const { code } = await api(t, '/api/t/access/create', { student_id: id, role: 'student' });
  const sp = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); sp.on('pageerror', (e) => errs.push(e.message));
  await sp.goto(APP + '/#c=' + code); await sp.waitForFunction(() => typeof S !== 'undefined' && S.role === 'student' && S.course, null, { timeout: 8000 });
  ok(await sp.evaluate(() => S.course.course) === 'funk', 'Schüler startet im Weg Kurs Funk');
  await sp.evaluate(async () => { S.stuCourseKey = 'indie'; S.course = await api('/api/course', { course: 'indie' }); S.overlay = null; render(); }); await sp.waitForTimeout(300);
  ok(/Funk Gitarre · Level 1 · Lektion 2/.test(await sp.textContent('body')) && /Scratches und Akzente/.test(await sp.textContent('body')), 'Aufgabe erscheint bei Deine Aufgaben, auch wenn gerade Indie offen ist');
  if (out) await sp.screenshot({ path: `${out}-schueler-aufgaben-390.png`, fullPage: true });
  await sp.click('.lesson-task [data-act=courseLesson]'); await sp.waitForTimeout(400);
  const h1s = await sp.locator('h1').allTextContents(); console.log(h1s, await sp.evaluate(() => [S.course.course, S.lessonId, typeof S.overlay === 'function' && S.overlay.name])); ok(h1s.some((x) => /Scratches/.test(x)) && await sp.evaluate(() => S.course.course) === 'funk', 'Lektion öffnen lädt den Funk Kurs');
  await p.evaluate(() => { const b = document.querySelector('[data-act=preview]'); b.click(); }); await p.waitForTimeout(800);
  ok(/Scratches und Akzente/.test(await p.textContent('body')), 'Schüleransicht in der Stunde zeigt die Kurs Aufgabe');
  if (out) { await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => render()); await p.waitForTimeout(300); await p.screenshot({ path: `${out}-stunde-kurs-390.png` }); }
  ok(!errs.length, 'keine Konsolenfehler ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
