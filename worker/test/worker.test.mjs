import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import worker, { cleanup, isMinor } from '../src/index.js';
import { makeD1 } from './d1-shim.mjs';

const ORIGIN = 'https://otierdei.github.io';

function setup() {
  const env = { DB: makeD1(), TEACHER_CODE: 'LEHRER2345XY', ALLOWED_ORIGINS: ORIGIN };
  const call = async (path, body, token, ip = '1.1.1.1', origin = ORIGIN) => {
    const headers = { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await worker.fetch(new Request('https://w.test' + path, { method: 'POST', headers, body: JSON.stringify(body || {}) }), env);
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
  return { env, call };
}

async function world() {
  const w = setup();
  const t = (await w.call('/api/login', { code: 'lehrer2345xy' })).data.token;
  const a = (await w.call('/api/t/student/save', { first_name: 'Anna', birth_year: 2013, weekday: 3, lesson_time: '16:00' }, t)).data.id;
  const b = (await w.call('/api/t/student/save', { first_name: 'Ben', birth_year: 1990, weekday: 4, lesson_time: '17:00' }, t)).data.id;
  const codeA = (await w.call('/api/t/access/create', { student_id: a, role: 'student' }, t)).data.code;
  const codeAP = (await w.call('/api/t/access/create', { student_id: a, role: 'parent', label: 'Mama' }, t)).data.code;
  const codeB = (await w.call('/api/t/access/create', { student_id: b, role: 'student' }, t)).data.code;
  const ta = (await w.call('/api/login', { code: codeA })).data.token;
  const tap = (await w.call('/api/login', { code: codeAP })).data.token;
  const tb = (await w.call('/api/login', { code: codeB })).data.token;
  const ex = (await w.call('/api/t/exercise/save', { title: 'Paradiddle Groove', category: 'Grooves', source_type: 'youtube', url: 'https://www.youtube.com/watch?v=abc', target_bpm: 96 }, t)).data.id;
  await w.call('/api/t/lesson/finish', { student_id: a, date: '2026-11-04', minutes: 45, notes_teacher: 'privat: müde', notes_shared: 'Hi Hat locker', new_assignments: [{ exercise_id: ex, target_bpm: 96, start_bpm: 80 }], new_goals: [{ title: 'Groove auf 96' }] }, t);
  await w.call('/api/t/lesson/finish', { student_id: b, date: '2026-11-05', notes_teacher: 'B privat', notes_shared: 'B geteilt', new_assignments: [{ free_text: 'Seite 12' }] }, t);
  return { ...w, t, a, b, codeA, ta, tap, tb, ex };
}

test('Ping und CORS nur für erlaubte Herkunft', async () => {
  const { call } = setup();
  const ok = await call('/api/ping', {}, null);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const bad = await call('/api/ping', {}, null, '1.1.1.1', 'https://boese.example');
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('isMinor: vorsichtig bei Grenzjahrgängen', () => {
  assert.equal(isMinor(2010, 2026), 1);
  assert.equal(isMinor(2009, 2026), 0);
  assert.equal(isMinor(null, 2026), 1);
});

test('Lehrer Login, falscher Code abgelehnt, Sperre nach 10 Fehlversuchen', async () => {
  const { call } = setup();
  assert.equal((await call('/api/login', { code: 'LEHRER2345XY' })).data.role, 'teacher');
  assert.equal((await call('/api/login', { code: 'FALSCH23456' })).status, 401);
  for (let i = 0; i < 10; i++) await call('/api/login', { code: 'FALSCH2345' + i }, null, '9.9.9.9');
  const locked = await call('/api/login', { code: 'LEHRER2345XY' }, null, '9.9.9.9');
  assert.equal(locked.status, 429);
});

test('Ohne Token kein Zugriff', async () => {
  const { call } = setup();
  assert.equal((await call('/api/home', {})).status, 401);
  assert.equal((await call('/api/home', {}, 'erfunden')).status, 401);
});

test('Schüler sieht nur eigene Daten und keine Lehrernotizen', async () => {
  const w = await world();
  const home = (await w.call('/api/home', {}, w.ta)).data;
  assert.equal(home.role, 'student');
  assert.equal(home.student.first_name, 'Anna');
  assert.equal(home.assignments.length, 1);
  assert.equal(home.lessons[0].notes_shared, 'Hi Hat locker');
  assert.equal(JSON.stringify(home).includes('privat'), false);
  assert.equal(JSON.stringify(home).includes('Ben'), false);
  assert.equal(JSON.stringify(home).includes('B geteilt'), false);
});

test('Schüler kann keine Lehrer Aktionen ausführen', async () => {
  const w = await world();
  for (const p of ['/api/t/student', '/api/t/student/save', '/api/t/access/create', '/api/t/feed', '/api/t/exercises', '/api/t/lesson/finish', '/api/t/student/delete']) {
    assert.equal((await w.call(p, { id: w.b, student_id: w.b, first_name: 'X' }, w.ta)).status, 403, p);
    assert.equal((await w.call(p, { id: w.b, student_id: w.b, first_name: 'X' }, w.tap)).status, 403, p);
  }
});

test('Übungssitzung: nur eigene Hausaufgabe, doppelte client_id zählt einmal', async () => {
  const w = await world();
  const ha = (await w.call('/api/home', {}, w.ta)).data.assignments[0];
  const hb = (await w.call('/api/home', {}, w.tb)).data.assignments[0];
  const s = { client_id: 'c1', assignment_id: ha.id, started_at: '2026-11-05T15:00:00Z', ended_at: '2026-11-05T15:12:00Z', local_date: '2026-11-05', seconds: 720, bpm_reached: 84, feeling: 4 };
  assert.equal((await w.call('/api/session/add', s, w.ta)).status, 200);
  assert.equal((await w.call('/api/session/add', s, w.ta)).data.duplicate, true);
  assert.equal((await w.call('/api/session/add', { ...s, client_id: 'c2', assignment_id: hb.id }, w.ta)).status, 403);
  assert.equal((await w.call('/api/session/add', { ...s, client_id: 'c3' }, w.tap)).status, 403, 'Eltern dürfen nicht schreiben');
  assert.equal((await w.call('/api/session/add', s, w.tb)).status, 403, 'fremde Hausaufgabe');
  assert.equal((await w.call('/api/session/add', { ...s, assignment_id: hb.id }, w.tb)).status, 409, 'fremde client_id');
  const home = (await w.call('/api/home', {}, w.ta)).data;
  assert.equal(home.sessions.length, 1);
  assert.equal(home.sessions[0].exercise_id, w.ex);
  const ov = (await w.call('/api/home', {}, w.t)).data.students.find((x) => x.id === w.a);
  assert.equal(ov.minutes_since, 12);
});

test('Hausaufgabe abhaken nur eigene', async () => {
  const w = await world();
  const ha = (await w.call('/api/home', {}, w.ta)).data.assignments[0];
  assert.equal((await w.call('/api/assignment/toggle', { id: ha.id, done: true }, w.tb)).status, 403);
  assert.equal((await w.call('/api/assignment/toggle', { id: ha.id, done: true }, w.ta)).status, 200);
  assert.equal((await w.call('/api/home', {}, w.ta)).data.assignments[0].status, 'erledigt');
});

test('Eltern sehen Kind lesend und geben Einwilligung; minderjähriger Schüler nicht', async () => {
  const w = await world();
  const home = (await w.call('/api/home', {}, w.tap)).data;
  assert.equal(home.role, 'parent');
  assert.equal(home.consent, null);
  assert.equal((await w.call('/api/consent', { version: home.consentVersion }, w.ta)).status, 403);
  assert.equal((await w.call('/api/consent', { version: 'alt' }, w.tap)).status, 400);
  assert.equal((await w.call('/api/consent', { version: home.consentVersion }, w.tap)).status, 200);
  assert.ok((await w.call('/api/home', {}, w.tap)).data.consent);
  const adult = (await w.call('/api/home', {}, w.tb)).data;
  assert.equal((await w.call('/api/consent', { version: adult.consentVersion }, w.tb)).status, 200, 'Erwachsener willigt selbst ein');
});

test('Link sperren meldet Geräte ab', async () => {
  const w = await world();
  const acc = (await w.call('/api/t/student', { id: w.a }, w.t)).data.access.find((x) => x.role === 'student');
  await w.call('/api/t/access/revoke', { id: acc.id }, w.t);
  assert.equal((await w.call('/api/home', {}, w.ta)).status, 401);
  assert.equal((await w.call('/api/login', { code: w.codeA })).status, 401);
});

test('Archivierter Schüler kann sich nicht anmelden; Aufräumen löscht nach 12 Monaten', async () => {
  const w = await world();
  await w.call('/api/t/student/save', { id: w.a, first_name: 'Anna', birth_year: 2013, status: 'archiviert' }, w.t);
  assert.equal((await w.call('/api/home', {}, w.ta)).status, 401);
  w.env.DB.raw.prepare('UPDATE students SET archived_at = ? WHERE id = ?').run('2025-01-01T00:00:00Z', w.a);
  const r = await cleanup(w.env);
  assert.equal(r.deletedStudents, 1);
  for (const tbl of ['students', 'access', 'lessons', 'assignments', 'goals', 'practice_sessions']) {
    const n = w.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE ${tbl === 'students' ? 'id' : 'student_id'} = ?`).get(w.a).n;
    assert.equal(n, 0, tbl);
  }
  assert.equal((await w.call('/api/t/student', { id: w.b }, w.t)).status, 200, 'Ben bleibt');
});

test('Lehrer Akte enthält private Notiz, Stunde beenden schließt Aufgaben und Ziele', async () => {
  const w = await world();
  const file = (await w.call('/api/t/student', { id: w.a }, w.t)).data;
  assert.equal(file.lessons[0].notes_teacher, 'privat: müde');
  const goal = file.goals[0];
  const asg = file.assignments[0];
  await w.call('/api/t/lesson/finish', { student_id: w.a, close_assignments: [asg.id], goals_reached: [goal.id], new_assignments: [{ free_text: 'Fill Seite 23' }] }, w.t);
  const f2 = (await w.call('/api/t/student', { id: w.a }, w.t)).data;
  assert.equal(f2.lessons.length, 2);
  assert.equal(f2.goals[0].status, 'erreicht');
  assert.equal(f2.assignments.find((x) => x.id === asg.id).status, 'erledigt');
  assert.equal(f2.assignments.filter((x) => x.status === 'offen').length, 1);
});

test('Übung nur mit https Link', async () => {
  const w = await world();
  assert.equal((await w.call('/api/t/exercise/save', { title: 'X', url: 'javascript:alert(1)' }, w.t)).status, 400);
  assert.equal((await w.call('/api/t/exercise/save', { title: 'Buch', book_ref: 'Stick Control S. 5' }, w.t)).status, 200);
});

test('Kaputtes JSON gibt 400, unbekannte Aktion 404', async () => {
  const { env } = setup();
  const res = await worker.fetch(new Request('https://w.test/api/login', { method: 'POST', body: '{kaputt' }), env);
  assert.equal(res.status, 400);
  const w = await world();
  assert.equal((await w.call('/api/t/gibtsnicht', {}, w.t)).status, 404);
});

test('Steckbrief nur für Lehrer, Instrument für Schüler sichtbar', async () => {
  const w = await world();
  await w.call('/api/t/student/save', { id: w.a, first_name: 'Anna', birth_year: 2013, instrument: 'Gitarre', profile_note: 'GEHEIMER STECKBRIEF' }, w.t);
  const home = (await w.call('/api/home', {}, w.ta)).data;
  assert.equal(home.student.instrument, 'Gitarre');
  assert.equal(JSON.stringify(home).includes('GEHEIMER'), false);
  assert.equal(JSON.stringify((await w.call('/api/home', {}, w.tap)).data).includes('GEHEIMER'), false);
  assert.equal((await w.call('/api/t/student', { id: w.a }, w.t)).data.student.profile_note, 'GEHEIMER STECKBRIEF');
});

test('Beat wird geprüft und kommt beim Schüler an', async () => {
  const w = await world();
  assert.equal((await w.call('/api/t/exercise/save', { title: 'Kaputt', notation: '{nein' }, w.t)).status, 400);
  const ex = (await w.call('/api/t/exercise/save', { title: 'Rock Beat', notation: { sig: '4/4', bars: 1, bpm: 90, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14, 99, -1], sn: [4, 12], bd: [0, 8, 8], xx: [1] } } }, w.t)).data.id;
  const list = (await w.call('/api/t/exercises', {}, w.t)).data.exercises;
  const e = list.find((x) => x.id === ex);
  assert.equal(e.source_type, 'noten');
  const n = JSON.parse(e.notation);
  assert.deepEqual(n.tracks.hh, [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(n.tracks.bd, [0, 8]);
  assert.equal(n.tracks.xx, undefined);
  await w.call('/api/t/lesson/finish', { student_id: w.a, new_assignments: [{ exercise_id: ex }] }, w.t);
  const home = (await w.call('/api/home', {}, w.ta)).data;
  assert.ok(home.assignments.some((a) => a.notation && JSON.parse(a.notation).bpm === 90));
});

test('Import alter Stunden: nur Lehrer, privat, ohne Protokollflut', async () => {
  const w = await world();
  const lessons = [{ date: '2023-02-02', notes_teacher: 'Sticks halten' }, { date: 'kaputt', notes_teacher: 'x' }, { date: '2023-02-09', notes_teacher: 'Metronom' }];
  assert.equal((await w.call('/api/t/import/lessons', { student_id: w.a, lessons }, w.ta)).status, 403);
  assert.equal((await w.call('/api/t/import/lessons', { student_id: w.a, lessons }, w.t)).data.imported, 2);
  const home = (await w.call('/api/home', {}, w.ta)).data;
  assert.equal(JSON.stringify(home).includes('Sticks halten'), false);
  const feed = (await w.call('/api/t/feed', {}, w.t)).data.feed.filter((f) => f.action === 'import');
  assert.equal(feed.length, 1);
});

test('Song Chart: 16 Takte, Teile, Wiederholungen; Gitarre wird geprüft', async () => {
  const w = await world();
  const id = (await w.call('/api/t/exercise/save', { title: 'Song', notation: { sig: '4/4', bars: 16, tracks: { bd: [0, 255, 256] }, marks: { 0: 'Intro', 4: 'Refrain', 20: 'zu weit' }, repeat: [0, 1, 2, 99] } }, w.t)).data.id;
  const e = (await w.call('/api/t/exercises', {}, w.t)).data.exercises.find((x) => x.id === id);
  const n = JSON.parse(e.notation);
  assert.equal(n.bars, 16); assert.deepEqual(n.tracks.bd, [0, 255]); assert.deepEqual(n.marks, { 0: 'Intro', 4: 'Refrain' }); assert.deepEqual(n.repeat, [1, 2]);
  const g = (await w.call('/api/t/exercise/save', { title: 'Gitarre', notation: { kind: 'guitar', capo: 2, chords: ['G', 'D', 'Em', 'C'], strum: { sub: 8, bars: 1, cells: ['D', '', 'D', 'U', 'Z', 'U', 'D', 'U'] }, tab: { bars: 1, notes: [[0, 0, 3], [0, 0, 5], [7, 1, 1], [5, 2, 30]] } } }, w.t)).data.id;
  const ge = JSON.parse((await w.call('/api/t/exercises', {}, w.t)).data.exercises.find((x) => x.id === g).notation);
  assert.equal(ge.kind, 'guitar'); assert.equal(ge.capo, 2); assert.deepEqual(ge.strum.cells, ['D', '', 'D', 'U', '', 'U', 'D', 'U']); assert.deepEqual(ge.tab.notes, [[0, 0, 3]]);
  assert.equal((await w.call('/api/t/exercise/save', { title: 'M', source_type: 'musora', url: 'https://app.musora.com/playlists/1' }, w.t)).status, 200);
});

// ---------- Songs aus Drive ----------
import { parseSongName, LIEDER_ROOT } from '../src/songs.js';
const entry = (id, name, folder) => `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/${folder ? 'drive/folders/' + id : 'file/d/' + id + '/view'}"><div class="flip-entry-title">${name}</div></a></div>`;
const DRIVE = {
  [LIEDER_ROOT]: entry('de', 'Deutsch', 1) + entry('en', 'English', 1) + entry('sets', 'Lieder sets', 1) + entry('x', 'Vorlage.docx'),
  de: entry('f1', 'Der Sieg gehört dir allein - A - 81.pdf') + entry('f2', 'Der Sieg gehört dir allein - G.pdf') + entry('f3', 'Gott der Wunder - E.pdf') + entry('sub', 'Weihnachten', 1),
  en: entry('f4', 'All Day-B 122.pdf') + entry('f5', 'Alive - C.pdf'),
  sets: entry('s1', 'Sonntag, 08.11.2099', 1),
  s1: entry('p1', '2. Gott der Wunder - E.pdf') + entry('p2', '1. Der Sieg gehört dir allein - A - 81.pdf') + entry('p3', '5. Tempel-A.pdf'),
};
function stubDrive() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { const id = new URL(u).searchParams.get('id'); return new Response(DRIVE[id] || '', { status: DRIVE[id] ? 200 : 404 }); };
  return () => { globalThis.fetch = orig; };
}

test('Songnamen werden zerlegt', () => {
  assert.deepEqual(parseSongName('1. Der Sieg gehört dir allein - A - 81.pdf'), { title: 'Der Sieg gehört dir allein', key: 'A', bpm: 81, kind: 'pdf' });
  assert.deepEqual(parseSongName('All Day-B 122.pdf'), { title: 'All Day', key: 'B', bpm: 122, kind: 'pdf' });
  assert.equal(parseSongName('5. Schaffe Raum-A.pdf').title, 'Schaffe Raum');
});

test('Abgleich, Bibliothek, Sonntag nur für Lobpreis, Meine Setlist, Bausteine', async () => {
  const w = await world(); const restore = stubDrive();
  try {
    const r = await w.call('/api/t/songs/sync', {}, w.t);
    assert.equal(r.status, 200); assert.equal(r.data.files, 5); assert.equal(r.data.sundays, 1);
    let home = (await w.call('/api/songs', {}, w.ta)).data;
    assert.equal(home.songs.length, 4, 'zwei Tonarten = ein Song');
    assert.equal(home.sunday, null, 'Anna spielt nicht im Lobpreis');
    assert.deepEqual(home.songs.find((x) => x.title === 'Der Sieg gehört dir allein').keys.sort(), ['A', 'G']);
    await w.call('/api/t/student/worship', { id: w.a, on: true }, w.t);
    home = (await w.call('/api/songs', {}, w.ta)).data;
    assert.equal(home.sunday.date, '2099-11-08');
    assert.deepEqual(home.sunday.items.map((i) => i.title), ['Der Sieg gehört dir allein', 'Gott der Wunder', 'Tempel']);
    assert.ok(home.sunday.items[0].song_id, 'Sonntagssong ist mit der Bibliothek verknüpft');
    assert.equal((await w.call('/api/songs', {}, w.tb)).data.sunday, null, 'Ben sieht keinen Sonntag');
    const sid = home.songs[0].id;
    assert.equal((await w.call('/api/my/song', { song_id: sid, on: true }, w.ta)).status, 200);
    assert.deepEqual((await w.call('/api/songs', {}, w.ta)).data.mine, [sid]);
    assert.deepEqual((await w.call('/api/songs', {}, w.tb)).data.mine, [], 'Setlist ist pro Schüler');
    assert.equal((await w.call('/api/my/song', { song_id: sid, on: true }, w.tap)).status, 403, 'Eltern bauen keine Setlist');
    assert.equal((await w.call('/api/t/song/part/save', { song_id: sid, title: 'Groove Vers', url: 'youtu.be/abcdefghijk' }, w.ta)).status, 403);
    await w.call('/api/t/song/part/save', { song_id: sid, title: 'Groove Vers', url: 'youtu.be/abcdefghijk' }, w.t);
    const det = (await w.call('/api/song', { id: sid }, w.ta)).data;
    assert.equal(det.parts[0].title, 'Groove Vers'); assert.equal(det.parts[0].url, 'https://youtu.be/abcdefghijk');
    assert.ok(det.files.length >= 1);
    assert.equal((await w.call('/api/t/student', { id: w.a }, w.t)).data.worship, true);
  } finally { restore(); }
});
test('Songnamen mit Bindestrichen statt Leerzeichen', () => {
  assert.deepEqual(parseSongName('Du-allein-rettest-mich-E.pdf'), { title: 'Du allein rettest mich', key: 'E', bpm: null, kind: 'pdf' });
  assert.equal(parseSongName('o-praise-the-name-anastasis-C-2.pdf').title, 'O praise the name anastasis');
  assert.equal(parseSongName('After Your Heart-chords-G-2.pdf').title, 'After Your Heart');
});
test('Eigene Ziele für alle Schüler, nur eigene änderbar', async () => {
  const w = await world();
  assert.equal((await w.call('/api/home', {}, w.ta)).data.canGoal, true);
  assert.equal((await w.call('/api/goal/add', { title: 'Mein Ziel' }, w.ta)).status, 200, 'auch mit 13');
  const r = await w.call('/api/goal/add', { title: 'Paradiddle auf 100' }, w.tb);
  assert.equal((await w.call('/api/goal/toggle', { id: r.data.id }, w.tb)).data.status, 'erreicht');
  assert.equal((await w.call('/api/goal/toggle', { id: r.data.id }, w.ta)).status, 404, 'fremdes Ziel nicht änderbar');
  assert.equal((await w.call('/api/goal/add', { title: 'x' }, w.tap)).status, 403, 'Eltern nicht');
  const g = (await w.call('/api/t/student', { id: w.b }, w.t)).data.goals;
  assert.ok(g.some((x) => x.title === 'Paradiddle auf 100' && x.status === 'erreicht'), 'Lehrer sieht das Ziel');
});

test('Kurs: Import, Lektion zuweisen und abhaken, Level, Rechte', async () => {
  const w = await world();
  const seed = { course: 'drums', levels: [{ level: 1, name: 'Starter' }, { level: 2, name: 'Beat Builder' }],
    lessons: [{ num: 1, level: 1, title: 'Namen des Drumsets', items: [{ kind: 'text', title: 'Bassdrum, Snare, Hi Hat' }] },
      { num: 2, level: 1, title: 'Beat 1', items: [{ kind: 'video', title: 'Beat 1 erklärt', url: 'https://youtu.be/abcdefghijk' }] },
      { num: 3, level: 2, title: 'Fill 1', items: [{ kind: 'song', title: 'Yellow', song_title: 'Yellow' }] }] };
  assert.equal((await w.call('/api/t/course/import', seed, w.ta)).status, 403, 'Schüler darf nicht importieren');
  assert.equal((await w.call('/api/t/course/import', seed, w.t)).data.lessons, 3);
  assert.equal((await w.call('/api/t/course/import', seed, w.t)).status, 409, 'kein doppelter Import');
  let c = (await w.call('/api/course', {}, w.ta)).data;
  assert.equal(c.lessons.length, 3); assert.equal(c.level.level, 1); assert.equal(c.level.done, 0);
  const [l1, l2, l3] = c.lessons;
  assert.equal((await w.call('/api/t/course/assign', { student_id: w.a, lesson_id: l1.id, status: 'offen' }, w.ta)).status, 403);
  await w.call('/api/t/course/assign', { student_id: w.a, lesson_id: l1.id, status: 'fertig' }, w.t);
  await w.call('/api/t/course/assign', { student_id: w.a, lesson_id: l2.id, status: 'fertig' }, w.t);
  await w.call('/api/t/course/assign', { student_id: w.a, lesson_id: l3.id, status: 'offen' }, w.t);
  c = (await w.call('/api/course', {}, w.ta)).data;
  assert.equal(c.level.level, 2, 'Level 1 komplett, jetzt Level 2'); assert.equal(c.progress[l3.id].status, 'offen');
  assert.deepEqual((await w.call('/api/course', {}, w.tb)).data.progress, {}, 'Fortschritt ist pro Schüler');
  assert.equal((await w.call('/api/course', { student_id: w.a }, w.t)).data.level.level, 2, 'Lehrer sieht Annas Level');
  const it = await w.call('/api/t/course/item/save', { lesson_id: l3.id, kind: 'video', title: 'Fill 1 langsam', url: 'youtu.be/abcdefghijk' }, w.t);
  assert.equal(it.status, 200);
  assert.equal((await w.call('/api/course', {}, w.ta)).data.lessons[2].items.length, 2);
  await w.call('/api/t/course/assign', { student_id: w.a, lesson_id: l3.id, status: null }, w.t);
  assert.equal((await w.call('/api/course', {}, w.ta)).data.progress[l3.id], undefined);
});

test('App: keine doppelten Funktionsnamen in index.html', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const names = [...html.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, [], 'doppelt: ' + dup.join(', '));
});
test('Lehrer trägt Einwilligung der Eltern ein', async () => {
  const w = await world();
  assert.equal((await w.call('/api/t/consent', { student_id: w.a }, w.ta)).status, 403);
  assert.equal((await w.call('/api/t/consent', { student_id: w.a, how: 'schriftlich' }, w.t)).status, 200);
  assert.ok((await w.call('/api/home', {}, w.ta)).data.consent, 'Anna gilt als eingewilligt');
  const c = (await w.call('/api/t/student', { id: w.a }, w.t)).data.consents[0];
  assert.equal(c.access_id, 'lehrer'); assert.match(c.version_text, /von Oti bestätigt: schriftlich/);
});
test('Kurs: eigene Unterlagen sieht nur der Lehrer', async () => {
  const w = await world();
  await w.call('/api/t/course/import', { course: 'drums', levels: [{ level: 1, name: 'Starter' }], lessons: [{ num: 1, level: 1, title: 'Beat 1', items: [{ kind: 'material', title: 'Rock Beats 1-5.pdf', notes: 'Ordner Drum RAUM' }, { kind: 'text', title: 'Hi Hat Achtel' }] }] }, w.t);
  assert.equal((await w.call('/api/course', {}, w.t)).data.lessons[0].items.length, 2);
  const st = (await w.call('/api/course', {}, w.ta)).data.lessons[0].items;
  assert.deepEqual(st.map((i) => i.kind), ['text'], 'Schüler sieht keine Unterlagen');
  assert.equal((await w.call('/api/course', {}, w.tap)).data.lessons[0].items.length, 1, 'Eltern auch nicht');
});
test('Kurs: Übung mit Noten (3/4, Handsatz) in einer Lektion', async () => {
  const w = await world();
  const ex = (await w.call('/api/t/exercise/save', { title: 'Walzer Beat', category: 'Kurs L16', notation: { v: 2, sig: '3/4', bars: 1, bpm: 90, tracks: { hh: [0, 2, 4, 6, 8, 10], sn: [4, 8], bd: [0, 12, 99] }, stick: { 0: 'R', 2: 'L', 5: 'X' } } }, w.t)).data.id;
  await w.call('/api/t/course/import', { course: 'drums', levels: [{ level: 1, name: 'Starter' }], lessons: [{ num: 1, level: 1, title: '3/4', items: [] }] }, w.t);
  const l = (await w.call('/api/course', {}, w.t)).data.lessons[0];
  assert.equal((await w.call('/api/t/course/item/save', { lesson_id: l.id, kind: 'exercise', title: 'x', exercise_id: 'gibtsnicht' }, w.t)).status, 404);
  assert.equal((await w.call('/api/t/course/item/save', { lesson_id: l.id, kind: 'exercise', title: 'Walzer Beat', exercise_id: ex }, w.t)).status, 200);
  const it = (await w.call('/api/course', {}, w.ta)).data.lessons[0].items[0];
  const n = JSON.parse(it.exercise.notation);
  assert.equal(n.sig, '3/4'); assert.deepEqual(n.tracks.bd, [0], 'Schritte außerhalb von 12 fliegen raus');
  assert.deepEqual(n.stick, { 0: 'R', 2: 'L' }, 'nur R und L');
});
