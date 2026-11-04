import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import worker, { cleanup, isMinor } from '../src/index.js';
import { makeD1 } from './d1-shim.mjs';

const schema = fileURLToPath(new URL('../schema.sql', import.meta.url));
const ORIGIN = 'https://otierdei.github.io';

function setup() {
  const env = { DB: makeD1(schema), TEACHER_CODE: 'LEHRER2345XY', ALLOWED_ORIGINS: ORIGIN };
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
