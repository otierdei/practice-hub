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
  const after = (await w.call('/api/home', {}, w.ta)).data.assignments[0];
  assert.equal(after.status, 'offen', 'Schüler Haken schließt die Aufgabe nicht');
  assert.ok(after.student_done_at, 'Schüler Haken ist gespeichert');
  const t = (await w.call('/api/t/student', { id: w.a }, w.t)).data.assignments.find((x) => x.id === ha.id);
  assert.ok(t.student_done_at, 'Lehrer sieht den Schüler Haken');
  await w.call('/api/assignment/toggle', { id: ha.id, done: false }, w.ta);
  assert.equal((await w.call('/api/home', {}, w.ta)).data.assignments[0].student_done_at, null);
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
  const ex = (await w.call('/api/t/exercise/save', { title: 'Walzer Beat', category: 'Kurs L16', notation: { v: 2, sig: '3/4', bars: 1, bpm: 90, tracks: { hh: [0, 2, 4, 6, 8, 10], sn: [4, 8], bd: [0, 12, 99] }, stick: { 0: 'R', 2: 'L', 4: 'K', 5: 'X' } } }, w.t)).data.id;
  await w.call('/api/t/course/import', { course: 'drums', levels: [{ level: 1, name: 'Starter' }], lessons: [{ num: 1, level: 1, title: '3/4', items: [] }] }, w.t);
  const l = (await w.call('/api/course', {}, w.t)).data.lessons[0];
  assert.equal((await w.call('/api/t/course/item/save', { lesson_id: l.id, kind: 'exercise', title: 'x', exercise_id: 'gibtsnicht' }, w.t)).status, 404);
  assert.equal((await w.call('/api/t/course/item/save', { lesson_id: l.id, kind: 'exercise', title: 'Walzer Beat', exercise_id: ex }, w.t)).status, 200);
  const it = (await w.call('/api/course', {}, w.ta)).data.lessons[0].items[0];
  const n = JSON.parse(it.exercise.notation);
  assert.equal(n.sig, '3/4'); assert.deepEqual(n.tracks.bd, [0], 'Schritte außerhalb von 12 fliegen raus');
  assert.deepEqual(n.stick, { 0: 'R', 2: 'L', 4: 'K' }, 'nur R, L und K');
});

test('Stunde: eine pro Tag, keine doppelte Hausaufgabe, Zusammenführen', async () => {
  const w = await world();
  const r1 = await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-01', minutes: 40, notes_teacher: 'Flam Übung\nRL KK', new_assignments: [{ free_text: 'RL KK Übung' }] }, w.t);
  const r2 = await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-01', minutes: 40, notes_teacher: 'flam übung\nAllelujah weiter', new_assignments: [{ free_text: 'rl kk übung ' }, { free_text: 'Allelujah' }] }, w.t);
  assert.equal(r2.data.id, r1.data.id, 'gleicher Tag = gleiche Stunde'); assert.equal(r2.data.merged, true);
  assert.deepEqual(r2.data.skipped, ['rl kk übung'], 'doppelte Hausaufgabe übersprungen');
  const f = (await w.call('/api/t/student', { id: w.b }, w.t)).data;
  const day = f.lessons.filter((l) => l.date === '2026-10-01');
  assert.equal(day.length, 1); assert.equal(day[0].notes_teacher, 'Flam Übung\nRL KK\nAllelujah weiter');
  assert.equal(f.assignments.filter((a) => /kk/i.test(a.free_text || '')).length, 1);
  // Altbestand: zwei Stunden am selben Tag direkt in der Datenbank, dann zusammenführen
  w.env.DB.raw.exec("INSERT INTO lessons (id, student_id, date, minutes, notes_teacher, created_at) VALUES ('x1', '" + w.b + "', '2026-11-04', 40, 'A', '2026-11-04T10:00:00Z'), ('x2', '" + w.b + "', '2026-11-04', 40, 'B', '2026-11-04T10:05:00Z')");
  assert.equal((await w.call('/api/t/lessons/merge', { keep_id: 'x2' }, w.ta)).status, 403);
  const m = await w.call('/api/t/lessons/merge', { keep_id: 'x2' }, w.t);
  assert.equal(m.data.merged, 1); assert.equal(m.data.notes_teacher, 'B\nA');
});

test('Beat direkt in der Stunde: Übung mit Noten, Tempo von bis, Bibliothek nur auf Wunsch', async () => {
  const w = await world();
  const beat = { v: 2, sig: '4/4', bars: 1, bpm: 50, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14], sn: [4, 12], bd: [0, 8] } };
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-02', new_assignments: [{ free_text: 'Groove A', notation: beat, start_bpm: 50, target_bpm: 70 }, { free_text: 'Groove B', notation: beat, save_library: true }] }, w.t);
  const a = (await w.call('/api/home', {}, w.tb)).data.assignments;
  const ga = a.find((x) => x.free_text === 'Groove A');
  assert.ok(ga.notation, 'Schüler sieht Noten'); assert.equal(ga.start_bpm, 50); assert.equal(ga.target_bpm, 70);
  const lib = (await w.call('/api/t/exercises', {}, w.t)).data.exercises.map((e) => e.title);
  assert.ok(lib.includes('Groove B') && !lib.includes('Groove A'), 'nur B in der Bibliothek');
});

test('Songs: Unterricht Song, Links mit Versionen, Song als Hausaufgabe, gespielt von', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Yellow' }, w.t)).data.id;
  assert.equal((await w.call('/api/t/song/create', { title: 'Yellow' }, w.ta)).status, 403);
  const add = await w.call('/api/t/song/links/add', { song_id: sid, lines: 'Easy | https://youtu.be/aaaaaaaaaaa\nOriginal: youtu.be/bbbbbbbbbbb\nhttps://youtu.be/ccccccccccc\nkein link' }, w.t);
  assert.equal(add.data.added, 3);
  const r = await w.call('/api/t/lesson/finish', { student_id: w.a, date: '2026-10-03', new_assignments: [{ song_id: sid, version: 'Easy' }, { song_id: sid, version: 'Original' }] }, w.t);
  assert.deepEqual(r.data.skipped, ['Yellow'], 'Song nur einmal offen');
  const a = (await w.call('/api/home', {}, w.ta)).data.assignments.find((x) => x.song_id === sid);
  assert.equal(a.song_version, 'Easy'); assert.equal(a.free_text, 'Yellow (Easy)');
  const d = (await w.call('/api/song', { id: sid }, w.ta)).data;
  assert.deepEqual(d.links.map((l) => l.version), ['Easy', 'Original', 'Original']);
  assert.deepEqual(d.playedBy, [], 'Schüler sieht nicht, wer den Song spielt');
  assert.deepEqual((await w.call('/api/song', { id: sid }, w.t)).data.playedBy, ['Anna']);
  assert.ok((await w.call('/api/songs', {}, w.ta)).data.songs.some((x) => x.id === sid && x.lang === 'unterricht'));
  assert.ok((await w.call('/api/t/song/candidates', {}, w.t)).status === 200);
});

test('Absagen: drei Arten, eine pro Tag, rückgängig, nur Lehrer', async () => {
  const w = await world();
  assert.equal((await w.call('/api/t/cancel', { student_id: w.a, date: '2026-11-06', kind: 'schueler' }, w.ta)).status, 403);
  await w.call('/api/t/cancel', { student_id: w.a, date: '2026-11-06', kind: 'schueler' }, w.t);
  await w.call('/api/t/cancel', { student_id: w.a, date: '2026-11-06', kind: 'kurzfristig' }, w.t);
  let c = (await w.call('/api/t/student', { id: w.a }, w.t)).data.cancellations;
  assert.equal(c.length, 1); assert.equal(c[0].kind, 'kurzfristig');
  await w.call('/api/t/cancel', { student_id: w.a, date: '2026-11-06', undo: true }, w.t);
  assert.equal((await w.call('/api/t/student', { id: w.a }, w.t)).data.cancellations.length, 0);
  assert.ok(Array.isArray((await w.call('/api/home', {}, w.t)).data.cancellations));
});

test('Kurs: leeres Level entfernen, Level rücken nach', async () => {
  const w = await world();
  await w.call('/api/t/course/import', { course: 'drums', levels: [{ level: 1, name: 'A' }, { level: 2, name: 'B' }, { level: 3, name: 'C' }], lessons: [{ num: 1, level: 1, title: 'x', items: [] }, { num: 2, level: 3, title: 'y', items: [] }] }, w.t);
  assert.equal((await w.call('/api/t/course/level/remove', { level: 1 }, w.t)).status, 409);
  assert.equal((await w.call('/api/t/course/level/remove', { level: 2 }, w.t)).status, 200);
  const c = (await w.call('/api/course', {}, w.ta)).data;
  assert.deepEqual(c.levels.map((l) => l.level + l.name), ['1A', '2C']);
  assert.equal(c.lessons.find((l) => l.title === 'y').level, 2);
});

test('Hausaufgabe bearbeiten: Tempo, Text, Noten nur bei eigener Übung', async () => {
  const w = await world();
  const beat = { v: 2, sig: '4/4', bars: 1, bpm: 60, tracks: { sn: [0] } };
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-04', new_assignments: [{ free_text: 'Beat X', notation: beat, start_bpm: 60, target_bpm: 80 }] }, w.t);
  let a = (await w.call('/api/t/student', { id: w.b }, w.t)).data.assignments.find((x) => x.free_text === 'Beat X');
  assert.equal((await w.call('/api/t/assignment/update', { id: a.id, start_bpm: 70 }, w.tb)).status, 403);
  await w.call('/api/t/assignment/update', { id: a.id, free_text: 'Beat Y', start_bpm: 70, target_bpm: 100, minutes_per_day: 15, notation: { ...beat, tracks: { sn: [0, 8] } } }, w.t);
  a = (await w.call('/api/home', {}, w.tb)).data.assignments.find((x) => x.id === a.id);
  assert.equal(a.free_text, 'Beat Y'); assert.equal(a.start_bpm, 70); assert.equal(a.target_bpm, 100); assert.equal(a.minutes_per_day, 15);
  assert.deepEqual(JSON.parse(a.notation).tracks.sn, [0, 8]);
});

test('Bibliothek: kein Name doppelt, auch beim Beat aus der Stunde', async () => {
  const w = await world();
  const id = (await w.call('/api/t/exercise/save', { title: 'Beat 1', category: 'Grooves' }, w.t)).data.id;
  let r = await w.call('/api/t/exercise/save', { title: '  beat   1 ', category: 'Fills' }, w.t);
  assert.equal(r.status, 409); assert.match(r.data.error, /Beat 1/);
  assert.equal((await w.call('/api/t/exercise/save', { id, title: 'Beat 1', category: 'Grooves', target_bpm: 90 }, w.t)).status, 200);
  const beat = { v: 2, sig: '4/4', bars: 1, bpm: 60, tracks: { sn: [0] } };
  r = await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-05', new_assignments: [{ free_text: 'Beat 1', notation: beat, save_library: true }] }, w.t);
  assert.equal(r.status, 409);
  assert.equal((await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-05', new_assignments: [{ free_text: 'Beat 1', notation: beat }] }, w.t)).status, 200);
  await w.call('/api/t/exercise/archive', { id }, w.t);
  assert.equal((await w.call('/api/t/exercise/save', { title: 'Beat 1' }, w.t)).status, 200);
});

test('Notenbild transkribieren: ohne Schlüssel 503, mit Schlüssel Beats, Baustein speichert Noten', async () => {
  const w = await world();
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await w.call('/api/t/transcribe', { image: img }, w.t)).status, 503);
  w.env.ANTHROPIC_API_KEY = 'test';
  assert.equal((await w.call('/api/t/transcribe', { image: img }, w.ta)).status, 403);
  assert.equal((await w.call('/api/t/transcribe', { image: 'nein' }, w.t)).status, 400);
  const orig = globalThis.fetch; let sent;
  globalThis.fetch = async (u, o) => { sent = { u, body: JSON.parse(o.body), key: o.headers['x-api-key'] }; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hier:\n{"beats":[{"title":"1)","sig":"4/4","bars":1,"tracks":{"hh":[0,2,4,6,8,10,12,14],"sn":[4,12],"bd":[0,8,99]}},{"sig":"4/4","bars":1,"tracks":{"bd":[0,10]}}],"hinweis":""}' }] }), { status: 200 }); };
  try {
    const r = (await w.call('/api/t/transcribe', { image: img }, w.t)).data;
    assert.equal(sent.u, 'https://api.anthropic.com/v1/messages'); assert.equal(sent.key, 'test');
    assert.equal(sent.body.messages[0].content[0].source.media_type, 'image/png');
    assert.equal(r.beats.length, 2); assert.deepEqual(r.beats[0].notation.tracks.bd, [0, 8]); assert.equal(r.beats[1].title, 'Beispiel 2');
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    assert.equal((await w.call('/api/t/transcribe', { image: img }, w.t)).status, 502);
  } finally { globalThis.fetch = orig; }
  delete w.env.ANTHROPIC_API_KEY; let asked = 0;
  w.env.AI = { run: async (model, input) => { asked++; if (asked === 1) throw new Error('5016: Prior to using this model, you must submit the prompt agree'); if (input.prompt === 'agree') return {}; assert.ok(Array.isArray(input.image) && input.image.length > 0); return { response: '{"beats":[{"sig":"4/4","bars":1,"tracks":{"sn":[4,12]}}]}' }; } };
  assert.equal((await w.call('/api/t/transcribe', { image: img }, w.t)).status, 503, 'ohne Schlüssel kein automatisches Gratis Modell');
  const cf = (await w.call('/api/t/transcribe', { image: img, model: '@cf/meta/llama-3.2-11b-vision-instruct' }, w.t)).data;
  assert.equal(cf.engine, 'cloudflare'); assert.deepEqual(cf.beats[0].notation.tracks.sn, [4, 12]); assert.equal(asked, 3, 'Lizenz einmal bestätigt, dann erneut gefragt');
  const sid = (await w.call('/api/t/song/create', { title: 'Am Kreuz' }, w.t)).data.id;
  const pid = (await w.call('/api/t/song/part/save', { song_id: sid, title: 'Groove Vers', notation: { sig: '4/4', bars: 1, tracks: { bd: [0, 8] } } }, w.t)).data.id;
  const det = (await w.call('/api/song', { id: sid }, w.ta)).data;
  assert.deepEqual(JSON.parse(det.parts.find((p) => p.id === pid).notation).tracks.bd, [0, 8]);
  await w.call('/api/t/song/part/delete', { id: pid }, w.t);
  assert.equal((await w.call('/api/song', { id: sid }, w.ta)).data.parts.length, 0);
});

test('Hausaufgabe ohne Stunde: Song Baustein mit Noten und Tempo', async () => {
  const w = await world();
  const before = (await w.call('/api/t/student', { id: w.b }, w.t)).data.lessons.length;
  const sid = (await w.call('/api/t/song/create', { title: 'Never Walk Alone' }, w.t)).data.id;
  const pid = (await w.call('/api/t/song/part/save', { song_id: sid, title: 'Chorus (Easy)', notation: { sig: '4/4', bars: 1, tracks: { bd: [0, 4] } } }, w.t)).data.id;
  assert.equal((await w.call('/api/t/assignment/add', { student_id: w.b, part_id: pid }, w.tb)).status, 403);
  assert.equal((await w.call('/api/t/assignment/add', { student_id: w.b, part_id: pid, start_bpm: 50, target_bpm: 80, due_date: '2026-11-15', version: 'Easy' }, w.t)).status, 200);
  assert.equal((await w.call('/api/t/assignment/add', { student_id: w.b, part_id: pid }, w.t)).status, 409);
  const a = (await w.call('/api/home', {}, w.tb)).data.assignments.find((x) => x.free_text === 'Never Walk Alone: Chorus (Easy)');
  assert.equal(a.start_bpm, 50); assert.equal(a.target_bpm, 80); assert.equal(a.song_id, sid); assert.deepEqual(JSON.parse(a.notation).tracks.bd, [0, 4]);
  assert.equal((await w.call('/api/t/student', { id: w.b }, w.t)).data.lessons.length, before, 'keine Stunde angelegt');
});

test('App Skripte tragen die Version des Service Worker Caches', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const v = sw.match(/ph-v(\d+)/)[1];
  for (const f of ['notation.js', 'guitar.js']) {
    assert.ok(html.includes(`src="${f}?v=${v}"`), f + ' in index.html mit ?v=' + v);
    assert.ok(sw.includes(`'${f}?v=${v}'`), f + ' im Cache mit ?v=' + v);
  }
  for (const k of ['bd', 'sn', 't1', 't2', 'ft', 'cr', 'hh', 'ho', 'rd']) assert.ok(sw.includes(`'samples/${k}.mp3?v=${v}'`), k + ' Sample im Cache mit ?v=' + v);
});

test('Hausaufgaben Reihenfolge per Ziehen, Schüler sieht sie gleich', async () => {
  const w = await world();
  for (const t of ['A', 'B', 'C']) await w.call('/api/t/assignment/add', { student_id: w.b, free_text: 'Reihe ' + t }, w.t);
  const ids = (await w.call('/api/t/student', { id: w.b }, w.t)).data.assignments.filter((a) => /^Reihe/.test(a.free_text)).map((a) => a.id);
  assert.equal((await w.call('/api/t/assignments/reorder', { student_id: w.b, ids: ids.slice().reverse() }, w.tb)).status, 403);
  assert.equal((await w.call('/api/t/assignments/reorder', { student_id: w.a, ids }, w.t)).status, 400, 'fremde Hausaufgaben');
  const order = [ids[1], ids[2], ids[0]];
  assert.equal((await w.call('/api/t/assignments/reorder', { student_id: w.b, ids: order }, w.t)).status, 200);
  const teacher = (await w.call('/api/t/student', { id: w.b }, w.t)).data.assignments.filter((a) => /^Reihe/.test(a.free_text)).map((a) => a.id);
  const student = (await w.call('/api/home', {}, w.tb)).data.assignments.filter((a) => /^Reihe/.test(a.free_text)).map((a) => a.id);
  assert.deepEqual(teacher, order); assert.deepEqual(student, order);
});

test('Eine Quelle: Baustein und Bibliothek Änderungen gelten überall', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'The Blood' }, w.t)).data.id;
  const pid = (await w.call('/api/t/song/part/save', { song_id: sid, title: 'Build', notation: { sig: '4/4', bars: 1, tracks: { sn: [0] } } }, w.t)).data.id;
  await w.call('/api/t/assignment/add', { student_id: w.b, part_id: pid, start_bpm: 50, target_bpm: 80 }, w.t);
  // Baustein im Song bearbeiten: Hausaufgabe zeigt sofort die neuen Noten und den neuen Titel
  assert.equal((await w.call('/api/t/song/part/update', { id: pid, title: 'Final Build', notation: { sig: '4/4', bars: 2, tracks: { sn: [0, 16] } } }, w.tb)).status, 403);
  await w.call('/api/t/song/part/update', { id: pid, title: 'Final Build', notes: 'laut', notation: { sig: '4/4', bars: 2, tracks: { sn: [0, 16] } } }, w.t);
  let a = (await w.call('/api/home', {}, w.tb)).data.assignments.find((x) => x.part_id === pid);
  assert.equal(a.title, 'The Blood: Final Build'); assert.deepEqual(JSON.parse(a.notation).tracks.sn, [0, 16]); assert.equal(a.exercise_notes, 'laut');
  // Noten in der Hausaufgabe bearbeiten: Baustein im Song ändert sich mit
  await w.call('/api/t/assignment/update', { id: a.id, notation: { sig: '4/4', bars: 1, tracks: { sn: [4] } }, start_bpm: 50, target_bpm: 80 }, w.t);
  const part = (await w.call('/api/song', { id: sid }, w.t)).data.parts.find((p) => p.id === pid);
  assert.deepEqual(JSON.parse(part.notation).tracks.sn, [4]);
  // Bibliotheksübung über eine Hausaufgabe bearbeiten: andere Schüler sehen es auch
  const ex = (await w.call('/api/t/exercise/save', { title: 'Groove X', notation: { sig: '4/4', bars: 1, tracks: { bd: [0] } } }, w.t)).data.id;
  await w.call('/api/t/lesson/finish', { student_id: w.a, date: '2026-10-06', new_assignments: [{ exercise_id: ex }] }, w.t);
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-06', new_assignments: [{ exercise_id: ex }] }, w.t);
  const ab = (await w.call('/api/t/student', { id: w.b }, w.t)).data.assignments.find((x) => x.exercise_id === ex);
  assert.equal((await w.call('/api/t/assignment/update', { id: ab.id, title: 'Paradiddle Groove' }, w.t)).status, 409, 'Bibliotheksname bleibt eindeutig');
  await w.call('/api/t/assignment/update', { id: ab.id, title: 'Groove Y', notation: { sig: '4/4', bars: 1, tracks: { bd: [0, 8] } } }, w.t);
  const aa = (await w.call('/api/t/student', { id: w.a }, w.t)).data.assignments.find((x) => x.exercise_id === ex);
  assert.equal(aa.title, 'Groove Y'); assert.deepEqual(JSON.parse(aa.notation).tracks.bd, [0, 8]);
});

test('Song Hausaufgabe: Ziel Tempo ist immer das Original BPM des Songs', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Tempo Song' }, w.t)).data.id;
  await w.env.DB.prepare("INSERT INTO song_files (drive_id, song_id, name, key_sig, bpm, kind, seen_at) VALUES ('f1', ?, 'Tempo Song-E-74.pdf', 'E', 74, 'pdf', '2026-11-09')").bind(sid).run();
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-07', new_assignments: [{ song_id: sid, version: 'Original', start_bpm: 45, target_bpm: 100 }] }, w.t);
  const t = (await w.call('/api/t/student', { id: w.b }, w.t)).data.assignments.find((a) => a.song_id === sid);
  const s = (await w.call('/api/home', {}, w.tb)).data.assignments.find((a) => a.song_id === sid);
  assert.equal(t.target_bpm, 74); assert.equal(s.target_bpm, 74); assert.equal(s.song_bpm, 74);
});

test('Neue Hausaufgaben kommen hinten an, in der Reihenfolge der Stunde', async () => {
  const w = await world();
  const before = (await w.call('/api/home', {}, w.tb)).data.assignments.filter((a) => a.status === 'offen').map((a) => a.id);
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-08', new_assignments: [{ free_text: 'Neu A' }, { free_text: 'Neu B' }] }, w.t);
  await w.call('/api/t/assignment/add', { student_id: w.b, free_text: 'Neu C' }, w.t);
  const now = (await w.call('/api/home', {}, w.tb)).data.assignments.filter((a) => a.status === 'offen');
  assert.deepEqual(now.slice(0, before.length).map((a) => a.id), before, 'alte bleiben vorne');
  assert.deepEqual(now.slice(before.length).map((a) => a.free_text), ['Neu A', 'Neu B', 'Neu C']);
});

test('Song BPM festlegen: gilt für Song und Ziel Tempo der Hausaufgaben', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Never walk alone' }, w.t)).data.id;
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-09', new_assignments: [{ song_id: sid, version: 'Original', start_bpm: 45, target_bpm: 100 }] }, w.t);
  assert.equal((await w.call('/api/t/song/bpm', { song_id: sid, bpm: 72 }, w.tb)).status, 403);
  await w.call('/api/t/song/bpm', { song_id: sid, bpm: 72, source: 'worshiptogether.com' }, w.t);
  const d = (await w.call('/api/song', { id: sid }, w.ta)).data.song; assert.equal(d.bpm, 72); assert.equal(d.bpm_source, 'worshiptogether.com');
  assert.equal((await w.call('/api/home', {}, w.tb)).data.assignments.find((a) => a.song_id === sid).target_bpm, 72);
  assert.equal((await w.call('/api/songs', {}, w.ta)).data.songs.find((s) => s.id === sid).bpm, 72);
});

test('Bausteine pro Version, Übernehmen nur auf Wunsch', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Versionen' }, w.t)).data.id;
  const pe = (await w.call('/api/t/song/part/save', { song_id: sid, title: 'Chorus (Easy)', version: 'Easy', notation: { sig: '4/4', bars: 1, tracks: { bd: [0] } } }, w.t)).data.id;
  await w.call('/api/t/song/part/save', { song_id: sid, title: 'Chorus (Original)', version: 'Original', notation: { sig: '4/4', bars: 1, tracks: { bd: [0, 8] } } }, w.t);
  let parts = (await w.call('/api/song', { id: sid }, w.t)).data.parts;
  assert.deepEqual(parts.map((p) => p.version), ['Easy', 'Original']);
  // Easy ändern: Original bleibt unverändert
  await w.call('/api/t/song/part/update', { id: pe, title: 'Chorus (Easy)', notation: { sig: '4/4', bars: 1, tracks: { bd: [0, 4] } } }, w.t);
  parts = (await w.call('/api/song', { id: sid }, w.t)).data.parts;
  assert.deepEqual(JSON.parse(parts.find((p) => p.version === 'Original').notation).tracks.bd, [0, 8]);
  // Auf Wunsch übernehmen: gleichnamigen Original Baustein überschreiben
  assert.equal((await w.call('/api/t/song/part/sync', { id: pe, version: 'Original' }, w.tb)).status, 403);
  const r = (await w.call('/api/t/song/part/sync', { id: pe, version: 'Original' }, w.t)).data; assert.equal(r.created, false);
  parts = (await w.call('/api/song', { id: sid }, w.t)).data.parts; assert.equal(parts.length, 2);
  assert.deepEqual(JSON.parse(parts.find((p) => p.version === 'Original').notation).tracks.bd, [0, 4]);
  // Neue Version: wird angelegt mit passendem Titel
  const r2 = (await w.call('/api/t/song/part/sync', { id: pe, version: 'Akustik' }, w.t)).data; assert.equal(r2.created, true);
  assert.ok((await w.call('/api/song', { id: sid }, w.t)).data.parts.some((p) => p.title === 'Chorus (Akustik)' && p.version === 'Akustik'));
});

test('Videos: eigene Version und Titel, Playthrough wird Oti Playthrough', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Video Song' }, w.t)).data.id;
  await w.call('/api/t/song/links/add', { song_id: sid, lines: 'https://youtu.be/abcdefghijk', version: 'Drumcam Live' }, w.t);
  let l = (await w.call('/api/song', { id: sid }, w.t)).data.links[0]; assert.equal(l.version, 'Drumcam Live');
  assert.equal((await w.call('/api/t/song/link/update', { id: l.id, version: 'Reel', title: 'Reel vom Sonntag' }, w.tb)).status, 403);
  await w.call('/api/t/song/link/update', { id: l.id, version: 'Reel', title: 'Reel vom Sonntag' }, w.t);
  l = (await w.call('/api/song', { id: sid }, w.ta)).data.links[0]; assert.equal(l.version, 'Reel'); assert.equal(l.title, 'Reel vom Sonntag');
  await w.env.DB.prepare("UPDATE song_links SET version = 'Playthrough' WHERE id = ?").bind(l.id).run();
  const { SONG_SCHEMA } = await import('../src/songs.js');
  for (const st of SONG_SCHEMA.split(';').map((x) => x.trim()).filter((x) => /^UPDATE song_links/.test(x))) await w.env.DB.prepare(st).run();
  assert.equal((await w.call('/api/song', { id: sid }, w.t)).data.links[0].version, 'Oti Playthrough');
});

test('Tempo: Song ohne Bereich (Original), Baustein 45 bis Original', async () => {
  const w = await world();
  const sid = (await w.call('/api/t/song/create', { title: 'Tempo Regeln' }, w.t)).data.id;
  await w.call('/api/t/song/bpm', { song_id: sid, bpm: 72 }, w.t);
  await w.call('/api/t/lesson/finish', { student_id: w.b, date: '2026-10-10', new_assignments: [{ song_id: sid, version: 'Original', start_bpm: 45, target_bpm: 100 }] }, w.t);
  const pid = (await w.call('/api/t/song/part/save', { song_id: sid, title: 'Chorus', notation: { sig: '4/4', bars: 1, tracks: { sn: [4] } } }, w.t)).data.id;
  await w.call('/api/t/assignment/add', { student_id: w.b, part_id: pid }, w.t);
  const as = (await w.call('/api/home', {}, w.tb)).data.assignments;
  const song = as.find((a) => a.song_id === sid && !a.part_id), part = as.find((a) => a.part_id === pid);
  assert.equal(song.start_bpm, null); assert.equal(song.target_bpm, 72);
  assert.equal(part.start_bpm, 45); assert.equal(part.target_bpm, 72);
});
