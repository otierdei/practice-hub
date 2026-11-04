// Practice Hub Worker v1 (04.11.2026)
// Rechte werden bei jeder Anfrage aus dem Gerätetoken abgeleitet, nie aus der Anfrage.

import { SCHEMA } from './schema.js';

const DAY = 86400000;
const TOKEN_DAYS = 180;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CONSENT_VERSION = 'v1 04.11.2026';

// ---------- kleine Helfer ----------
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const str = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const int = (v, min, max) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function isMinor(birthYear, year = new Date().getFullYear()) {
  if (!birthYear) return 1; // ohne Angabe vorsichtig als minderjährig behandeln
  return year - birthYear <= 16 ? 1 : 0;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Speicher: dünne Schnittstelle über D1 ----------
function store(env) {
  const db = env.DB;
  return {
    all: async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [],
    first: (sql, ...a) => db.prepare(sql).bind(...a).first(),
    run: (sql, ...a) => db.prepare(sql).bind(...a).run(),
    batch: (list) => db.batch(list.map(([sql, a]) => db.prepare(sql).bind(...(a || [])))),
  };
}

// ---------- CORS ----------
function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
}

// ---------- Anmeldung ----------
async function login(env, s, body, ip) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const tries = await s.first('SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND at > ?', ip, since);
  if ((tries?.n || 0) >= 10) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten nochmal.');
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 8) throw new HttpError(400, 'Der Code ist zu kurz.');
  const hash = await sha256(code);
  let accessId = null, role = null, name = null;
  const teacherHash = env.TEACHER_CODE_HASH || (env.TEACHER_CODE ? await sha256(String(env.TEACHER_CODE).toUpperCase()) : null);
  if (teacherHash && hash === teacherHash) {
    accessId = 'teacher'; role = 'teacher'; name = 'Oti';
  } else {
    const a = await s.first(
      `SELECT a.id, a.role, a.label, st.first_name FROM access a JOIN students st ON st.id = a.student_id
       WHERE a.code_hash = ? AND a.revoked_at IS NULL AND st.status != 'archiviert'`, hash);
    if (a) { accessId = a.id; role = a.role; name = a.role === 'parent' ? (a.label || 'Eltern') : a.first_name; }
  }
  if (!accessId) {
    await s.run('INSERT INTO attempts (ip, at) VALUES (?, ?)', ip, now());
    throw new HttpError(401, 'Dieser Link oder Code ist ungültig oder wurde gesperrt.');
  }
  const token = randomToken();
  const t = now();
  await s.run('INSERT INTO devices (id, access_id, token_hash, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    uid(), accessId, await sha256(token), t, t, new Date(Date.now() + TOKEN_DAYS * DAY).toISOString());
  return { token, role, name };
}

async function authenticate(env, s, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Bitte neu anmelden.');
  const d = await s.first('SELECT * FROM devices WHERE token_hash = ?', await sha256(m[1]));
  if (!d || d.expires_at < now()) throw new HttpError(401, 'Anmeldung abgelaufen. Bitte deinen Link neu öffnen.');
  if (Date.parse(d.last_seen) < Date.now() - DAY) {
    await s.run('UPDATE devices SET last_seen = ?, expires_at = ? WHERE id = ?', now(), new Date(Date.now() + TOKEN_DAYS * DAY).toISOString(), d.id);
  }
  if (d.access_id === 'teacher') return { role: 'teacher', deviceId: d.id, accessId: 'teacher' };
  const a = await s.first(
    `SELECT a.id, a.role, a.student_id, a.label FROM access a JOIN students st ON st.id = a.student_id
     WHERE a.id = ? AND a.revoked_at IS NULL AND st.status != 'archiviert'`, d.access_id);
  if (!a) throw new HttpError(401, 'Dieser Zugang wurde gesperrt.');
  return { role: a.role, studentId: a.student_id, accessId: a.id, label: a.label, deviceId: d.id };
}

const logRow = (who, action, entity, id, summary) => [
  'INSERT INTO log (at, by_role, by_id, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [now(), who.role, who.accessId || null, action, entity, id, str(summary, 300)],
];

// ---------- Lesen für Schüler und Eltern ----------
async function studentView(s, studentId, role) {
  const st = await s.first('SELECT id, first_name, birth_year, is_minor, weekday, lesson_time, lesson_minutes, level, instrument FROM students WHERE id = ?', studentId);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const [assignments, sessions, goals, lessons, consent] = await Promise.all([
    s.all(`SELECT a.id, a.exercise_id, a.free_text, a.target_bpm, a.start_bpm, a.minutes_per_day, a.due_date, a.status, a.done_at, a.created_at,
             e.title, e.category, e.source_type, e.url, e.book_ref, e.notes AS exercise_notes, e.notation
           FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id
           WHERE a.student_id = ? AND (a.status = 'offen' OR a.done_at > ?) ORDER BY a.created_at DESC`, studentId, new Date(Date.now() - 21 * DAY).toISOString()),
    s.all(`SELECT id, client_id, assignment_id, exercise_id, started_at, local_date, seconds, bpm_reached, feeling, note
           FROM practice_sessions WHERE student_id = ? AND started_at > ? ORDER BY started_at DESC`, studentId, since),
    s.all('SELECT id, title, status, reached_at FROM goals WHERE student_id = ? ORDER BY created_at', studentId),
    s.all('SELECT id, date, minutes, notes_shared FROM lessons WHERE student_id = ? ORDER BY date DESC LIMIT 60', studentId),
    s.first(`SELECT given_at FROM consents WHERE student_id = ? AND kind = 'app' ORDER BY given_at DESC LIMIT 1`, studentId),
  ]);
  return { role, student: st, assignments, sessions, goals, lessons, consent: consent ? consent.given_at : null, consentVersion: CONSENT_VERSION };
}

async function addSession(s, who, b) {
  const clientId = str(b.client_id, 64);
  if (!clientId) throw new HttpError(400, 'client_id fehlt.');
  const seconds = int(b.seconds, 1, 6 * 3600);
  if (!seconds) throw new HttpError(400, 'Die Übezeit fehlt.');
  if (!isDate(b.local_date)) throw new HttpError(400, 'Datum fehlt.');
  const started = str(b.started_at, 40), ended = str(b.ended_at, 40);
  if (!started || isNaN(Date.parse(started)) || !ended || isNaN(Date.parse(ended))) throw new HttpError(400, 'Zeitangaben fehlen.');
  let assignmentId = str(b.assignment_id, 64), exerciseId = str(b.exercise_id, 64);
  if (assignmentId) {
    const a = await s.first('SELECT id, exercise_id FROM assignments WHERE id = ? AND student_id = ?', assignmentId, who.studentId);
    if (!a) throw new HttpError(403, 'Diese Hausaufgabe gehört nicht zu dir.');
    exerciseId = a.exercise_id;
  } else if (exerciseId) {
    const e = await s.first('SELECT id FROM exercises WHERE id = ?', exerciseId);
    if (!e) exerciseId = null;
  }
  const dup = await s.first('SELECT id, student_id FROM practice_sessions WHERE client_id = ?', clientId);
  if (dup) {
    if (dup.student_id !== who.studentId) throw new HttpError(409, 'Konflikt.');
    return { id: dup.id, duplicate: true };
  }
  const id = uid();
  await s.batch([
    [`INSERT INTO practice_sessions (id, client_id, student_id, assignment_id, exercise_id, started_at, ended_at, local_date, seconds, bpm_reached, feeling, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, clientId, who.studentId, assignmentId, exerciseId, started, ended, b.local_date, seconds, int(b.bpm_reached, 20, 400), int(b.feeling, 1, 5), str(b.note, 500), now()]],
    logRow(who, 'session', 'practice_sessions', id, `${Math.round(seconds / 60)} min geübt`),
  ]);
  return { id };
}

// ---------- Lehrer ----------
async function teacherOverview(s) {
  const students = await s.all(`SELECT id, first_name, birth_year, is_minor, weekday, lesson_time, lesson_minutes, level, instrument, status FROM students WHERE status != 'archiviert' ORDER BY weekday, lesson_time, first_name`);
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const weekAgoDate = weekAgo.toISOString().slice(0, 10);
  const lastLessons = await s.all('SELECT student_id, MAX(date) AS last FROM lessons GROUP BY student_id');
  const last = Object.fromEntries(lastLessons.map((r) => [r.student_id, r.last]));
  const sessions = await s.all('SELECT student_id, local_date, seconds FROM practice_sessions WHERE started_at > ?', new Date(Date.now() - 45 * DAY).toISOString());
  const consents = await s.all(`SELECT DISTINCT student_id FROM consents WHERE kind = 'app'`);
  const consented = new Set(consents.map((r) => r.student_id));
  const parents = await s.all(`SELECT DISTINCT student_id FROM access WHERE role = 'parent' AND revoked_at IS NULL`);
  const hasParent = new Set(parents.map((r) => r.student_id));
  for (const st of students) {
    const from = last[st.id] || weekAgoDate;
    const mine = sessions.filter((x) => x.student_id === st.id);
    st.last_lesson = last[st.id] || null;
    st.minutes_since = Math.round(mine.filter((x) => x.local_date >= from).reduce((t, x) => t + x.seconds, 0) / 60);
    st.days_7 = new Set(mine.filter((x) => x.local_date > weekAgoDate).map((x) => x.local_date)).size;
    st.consent = consented.has(st.id);
    st.has_parent = hasParent.has(st.id);
  }
  return { students };
}

async function teacherStudent(s, id) {
  const st = await s.first('SELECT * FROM students WHERE id = ?', id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const [lessons, assignments, sessions, goals, access, consents] = await Promise.all([
    s.all('SELECT * FROM lessons WHERE student_id = ? ORDER BY date DESC', id),
    s.all(`SELECT a.*, e.title, e.category, e.source_type, e.url, e.book_ref, e.notation FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id
           WHERE a.student_id = ? ORDER BY a.created_at DESC LIMIT 200`, id),
    s.all('SELECT id, assignment_id, exercise_id, started_at, local_date, seconds, bpm_reached, feeling, note FROM practice_sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT 400', id),
    s.all('SELECT * FROM goals WHERE student_id = ? ORDER BY created_at', id),
    s.all(`SELECT a.id, a.role, a.label, a.created_at, a.revoked_at,
             (SELECT MAX(d.last_seen) FROM devices d WHERE d.access_id = a.id) AS last_seen
           FROM access a WHERE a.student_id = ? ORDER BY a.created_at`, id),
    s.all('SELECT id, access_id, kind, version_text, given_at FROM consents WHERE student_id = ? ORDER BY given_at DESC', id),
  ]);
  return { student: st, lessons, assignments, sessions, goals, access, consents };
}

async function saveStudent(s, who, b) {
  const first = str(b.first_name, 60);
  if (!first) throw new HttpError(400, 'Vorname fehlt.');
  const birth = int(b.birth_year, 1930, new Date().getFullYear());
  const weekday = int(b.weekday, 1, 7);
  const time = isTime(b.lesson_time) ? b.lesson_time : null;
  const minutes = int(b.lesson_minutes, 15, 180) || 45;
  const status = ['aktiv', 'pausiert', 'archiviert'].includes(b.status) ? b.status : 'aktiv';
  const level = str(b.level, 60);
  const instrument = str(b.instrument, 60) || 'Schlagzeug';
  const profile = str(b.profile_note, 4000);
  if (b.id) {
    const old = await s.first('SELECT id, status, archived_at FROM students WHERE id = ?', b.id);
    if (!old) throw new HttpError(404, 'Schüler nicht gefunden.');
    const archivedAt = status === 'archiviert' ? (old.archived_at || now()) : null;
    await s.batch([
      ['UPDATE students SET first_name=?, birth_year=?, is_minor=?, weekday=?, lesson_time=?, lesson_minutes=?, level=?, instrument=?, profile_note=?, status=?, archived_at=? WHERE id=?',
        [first, birth, isMinor(birth), weekday, time, minutes, level, instrument, profile, status, archivedAt, b.id]],
      logRow(who, 'update', 'students', b.id, first),
    ]);
    return { id: b.id };
  }
  const id = uid();
  await s.batch([
    ['INSERT INTO students (id, first_name, birth_year, is_minor, weekday, lesson_time, lesson_minutes, level, instrument, profile_note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, first, birth, isMinor(birth), weekday, time, minutes, level, instrument, profile, status, now()]],
    logRow(who, 'create', 'students', id, first),
  ]);
  return { id };
}

async function deleteStudent(s, who, id) {
  const st = await s.first('SELECT id FROM students WHERE id = ?', id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  await s.batch(deleteStudentStatements(id).concat([logRow(who, 'delete', 'students', id, 'gelöscht')]));
  return { ok: true };
}
function deleteStudentStatements(id) {
  return [
    ['DELETE FROM devices WHERE access_id IN (SELECT id FROM access WHERE student_id = ?)', [id]],
    ['DELETE FROM access WHERE student_id = ?', [id]],
    ['DELETE FROM consents WHERE student_id = ?', [id]],
    ['DELETE FROM practice_sessions WHERE student_id = ?', [id]],
    ['DELETE FROM assignments WHERE student_id = ?', [id]],
    ['DELETE FROM goals WHERE student_id = ?', [id]],
    ['DELETE FROM lessons WHERE student_id = ?', [id]],
    ['DELETE FROM students WHERE id = ?', [id]],
    ['UPDATE log SET summary = NULL WHERE entity_id = ?', [id]],
  ];
}

async function createAccess(s, who, b) {
  const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', b.student_id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const role = b.role === 'parent' ? 'parent' : 'student';
  const code = randomCode(10);
  const id = uid();
  await s.batch([
    ['INSERT INTO access (id, student_id, role, label, code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, st.id, role, str(b.label, 40), await sha256(code), now()]],
    logRow(who, 'access', 'access', id, `${role === 'parent' ? 'Elternlink' : 'Schülerlink'} für ${st.first_name}`),
  ]);
  return { id, code };
}

async function revokeAccess(s, who, id) {
  const a = await s.first('SELECT id FROM access WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'Zugang nicht gefunden.');
  await s.batch([
    ['UPDATE access SET revoked_at = ? WHERE id = ?', [now(), id]],
    ['DELETE FROM devices WHERE access_id = ?', [id]],
    logRow(who, 'revoke', 'access', id, 'gesperrt'),
  ]);
  return { ok: true };
}

async function saveExercise(s, who, b) {
  const title = str(b.title, 120);
  if (!title) throw new HttpError(400, 'Titel fehlt.');
  const notation = cleanNotation(b.notation);
  const sourceType = ['youtube', 'instagram', 'drive', 'buch', 'link', 'noten', 'musora'].includes(b.source_type) ? b.source_type : (notation ? 'noten' : b.url ? 'link' : 'buch');
  let url = str(b.url, 500);
  if (url && !/^https:\/\//i.test(url)) throw new HttpError(400, 'Der Link muss mit https:// beginnen.');
  const vals = [title, str(b.category, 40), sourceType, url, str(b.book_ref, 120), int(b.target_bpm, 20, 400), str(b.notes, 1000), notation];
  if (b.id) {
    await s.batch([
      ['UPDATE exercises SET title=?, category=?, source_type=?, url=?, book_ref=?, target_bpm=?, notes=?, notation=? WHERE id=?', [...vals, b.id]],
      logRow(who, 'update', 'exercises', b.id, title),
    ]);
    return { id: b.id };
  }
  const id = uid();
  await s.batch([
    ['INSERT INTO exercises (id, title, category, source_type, url, book_ref, target_bpm, notes, notation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, ...vals, now()]],
    logRow(who, 'create', 'exercises', id, title),
  ]);
  return { id };
}

// Beat aus dem Noten Editor prüfen und normalisieren
export const DRUMS = ['cr', 'rd', 'hh', 'ho', 'sn', 'gh', 't1', 't2', 'ft', 'bd', 'hf'];
export function cleanNotation(n) {
  if (n == null || n === '') return null;
  let o = n;
  if (typeof n === 'string') { if (n.length > 40000) throw new HttpError(400, 'Noten zu groß.'); try { o = JSON.parse(n); } catch (e) { throw new HttpError(400, 'Noten sind beschädigt.'); } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'Noten sind beschädigt.');
  if (o.kind === 'guitar') return cleanGuitar(o);
  const sig = o.sig === '6/8' ? '6/8' : '4/4';
  const bars = int(o.bars, 1, 16) || 1;
  const steps = (sig === '6/8' ? 12 : 16) * bars;
  const tracks = {};
  for (const k of DRUMS) {
    const list = Array.isArray(o.tracks && o.tracks[k]) ? o.tracks[k] : [];
    tracks[k] = [...new Set(list.map((x) => Math.round(Number(x))).filter((x) => Number.isInteger(x) && x >= 0 && x < steps))].sort((a, b) => a - b);
  }
  const marks = {};
  for (const [k, v] of Object.entries(o.marks && typeof o.marks === 'object' ? o.marks : {})) {
    const bar = Number(k); const t = str(v, 30);
    if (Number.isInteger(bar) && bar >= 0 && bar < bars && t) marks[bar] = t;
  }
  const repeat = [...new Set((Array.isArray(o.repeat) ? o.repeat : []).map(Number).filter((x) => Number.isInteger(x) && x > 0 && x < bars))].sort((a, b) => a - b);
  return JSON.stringify({ v: 2, sig, bars, bpm: int(o.bpm, 30, 300) || 80, tracks, marks, repeat });
}
// Gitarre: Akkorde, Schlagmuster, Tabs, Capo
function cleanGuitar(o) {
  const chords = (Array.isArray(o.chords) ? o.chords : []).slice(0, 16).map((c) => str(c, 24)).filter(Boolean);
  const sub = o.strum && Number(o.strum.sub) === 16 ? 16 : 8;
  const sbars = int(o.strum && o.strum.bars, 1, 4) || 1;
  const cells = Array.from({ length: sub * sbars }, (_, i) => { const v = o.strum && Array.isArray(o.strum.cells) ? o.strum.cells[i] : ''; return ['D', 'U', 'X'].includes(v) ? v : ''; });
  const tbars = int(o.tab && o.tab.bars, 1, 8) || 1;
  const seen = new Set();
  const notes = (o.tab && Array.isArray(o.tab.notes) ? o.tab.notes : []).slice(0, 2000).map((x) => (Array.isArray(x) ? x.map((y) => Math.round(Number(y))) : []))
    .filter(([st, step, fret]) => st >= 0 && st <= 5 && step >= 0 && step < tbars * 16 && fret >= 0 && fret <= 24 && !seen.has(st + ':' + step) && seen.add(st + ':' + step));
  return JSON.stringify({ kind: 'guitar', v: 1, bpm: int(o.bpm, 30, 300) || 80, capo: int(o.capo, 0, 12) || 0, key: str(o.key, 6), chords,
    strum: { sub, bars: sbars, cells }, tab: { bars: tbars, notes } });
}

// Import alter Stunden aus Otis Notizen: viele Stunden auf einmal, ohne Protokollflut
async function importLessons(s, who, b) {
  const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', String(b.student_id || ''));
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const list = (Array.isArray(b.lessons) ? b.lessons : []).slice(0, 200);
  const t = now();
  const stmts = [];
  for (const l of list) {
    if (!isDate(l.date)) continue;
    stmts.push(['INSERT INTO lessons (id, student_id, date, minutes, notes_teacher, notes_shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uid(), st.id, l.date, int(l.minutes, 5, 240), str(l.notes_teacher, 6000), str(l.notes_shared, 3000), t]]);
  }
  const n = stmts.length;
  for (const a of (Array.isArray(b.assignments) ? b.assignments : []).slice(0, 20)) {
    const free = str(a.free_text, 300);
    if (free) stmts.push(["INSERT INTO assignments (id, student_id, free_text, target_bpm, minutes_per_day, status, created_at) VALUES (?, ?, ?, ?, ?, 'offen', ?)", [uid(), st.id, free, int(a.target_bpm, 20, 400), int(a.minutes_per_day, 1, 240), t]]);
  }
  if (stmts.length) {
    stmts.push(logRow(who, 'import', 'lessons', st.id, `${n} alte Stunden für ${st.first_name} importiert`));
    await s.batch(stmts);
  }
  return { imported: n, assignments: stmts.length ? stmts.length - 1 - n : 0 };
}

async function finishLesson(s, who, b) {
  const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', b.student_id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const lessonId = uid();
  const t = now();
  const stmts = [[
    'INSERT INTO lessons (id, student_id, date, minutes, notes_teacher, notes_shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [lessonId, st.id, date, int(b.minutes, 5, 240), str(b.notes_teacher, 3000), str(b.notes_shared, 3000), t],
  ]];
  for (const a of (Array.isArray(b.new_assignments) ? b.new_assignments : []).slice(0, 20)) {
    let exId = str(a.exercise_id, 64);
    if (exId && !(await s.first('SELECT id FROM exercises WHERE id = ?', exId))) exId = null;
    const free = str(a.free_text, 300);
    if (!exId && !free) continue;
    stmts.push(['INSERT INTO assignments (id, student_id, lesson_id, exercise_id, free_text, target_bpm, start_bpm, minutes_per_day, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uid(), st.id, lessonId, exId, free, int(a.target_bpm, 20, 400), int(a.start_bpm, 20, 400), int(a.minutes_per_day, 1, 240), isDate(a.due_date) ? a.due_date : null, 'offen', t]]);
  }
  for (const id of (Array.isArray(b.close_assignments) ? b.close_assignments : []).slice(0, 50)) {
    stmts.push(["UPDATE assignments SET status = 'erledigt', done_at = COALESCE(done_at, ?) WHERE id = ? AND student_id = ?", [t, String(id), st.id]]);
  }
  for (const id of (Array.isArray(b.goals_reached) ? b.goals_reached : []).slice(0, 50)) {
    stmts.push(["UPDATE goals SET status = 'erreicht', reached_at = ? WHERE id = ? AND student_id = ?", [t, String(id), st.id]]);
  }
  for (const g of (Array.isArray(b.new_goals) ? b.new_goals : []).slice(0, 10)) {
    const title = str(g.title || g, 160);
    if (title) stmts.push(['INSERT INTO goals (id, student_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)', [uid(), st.id, title, 'offen', t]]);
  }
  stmts.push(logRow(who, 'lesson', 'lessons', lessonId, `Stunde mit ${st.first_name}`));
  await s.batch(stmts);
  return { id: lessonId };
}

// ---------- Aufräumen (täglich) ----------
export async function cleanup(env) {
  const s = store(env);
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString();
  const old = await s.all("SELECT id FROM students WHERE status = 'archiviert' AND archived_at < ?", yearAgo);
  for (const r of old) await s.batch(deleteStudentStatements(r.id));
  await s.run('DELETE FROM devices WHERE expires_at < ?', now());
  await s.run('DELETE FROM attempts WHERE at < ?', new Date(Date.now() - DAY).toISOString());
  await s.run('DELETE FROM log WHERE at < ?', new Date(Date.now() - 2 * 365 * DAY).toISOString());
  return { deletedStudents: old.length };
}

// ---------- Router ----------
async function route(env, req, path, body) {
  const s = store(env);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (path === '/api/ping') return { ok: true, version: 1 };
  if (path === '/api/login') return login(env, s, body, ip);

  const who = await authenticate(env, s, req);
  const own = who.role === 'student' || who.role === 'parent';

  if (path === '/api/logout') { await s.run('DELETE FROM devices WHERE id = ?', who.deviceId); return { ok: true }; }

  if (path === '/api/home') {
    if (own) return studentView(s, who.studentId, who.role);
    return { role: 'teacher', ...(await teacherOverview(s)) };
  }
  if (path === '/api/session/add') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler können Übezeit eintragen.');
    return addSession(s, who, body);
  }
  if (path === '/api/assignment/toggle') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler können Hausaufgaben abhaken.');
    const a = await s.first('SELECT id, status FROM assignments WHERE id = ? AND student_id = ?', String(body.id || ''), who.studentId);
    if (!a) throw new HttpError(403, 'Diese Hausaufgabe gehört nicht zu dir.');
    const done = !!body.done;
    await s.batch([
      ['UPDATE assignments SET status = ?, done_at = ? WHERE id = ?', [done ? 'erledigt' : 'offen', done ? now() : null, a.id]],
      logRow(who, done ? 'done' : 'undone', 'assignments', a.id, done ? 'erledigt' : 'wieder offen'),
    ]);
    return { ok: true };
  }
  if (path === '/api/consent') {
    if (who.role !== 'parent') {
      const st = await s.first('SELECT is_minor FROM students WHERE id = ?', who.studentId || '');
      if (who.role !== 'student' || !st || st.is_minor) throw new HttpError(403, 'Bei Schülern unter 16 stimmen die Eltern zu.');
    }
    if (body.version !== CONSENT_VERSION) throw new HttpError(400, 'Bitte die Seite neu laden, der Text hat sich geändert.');
    const id = uid();
    await s.batch([
      ["INSERT INTO consents (id, student_id, access_id, kind, version_text, given_at) VALUES (?, ?, ?, 'app', ?, ?)", [id, who.studentId, who.accessId, CONSENT_VERSION, now()]],
      logRow(who, 'consent', 'consents', id, 'Einwilligung gegeben'),
    ]);
    return { ok: true };
  }

  // ab hier nur Lehrer
  if (who.role !== 'teacher') throw new HttpError(403, 'Kein Zugriff.');
  switch (path) {
    case '/api/t/student': return teacherStudent(s, String(body.id || ''));
    case '/api/t/student/save': return saveStudent(s, who, body);
    case '/api/t/student/delete': return deleteStudent(s, who, String(body.id || ''));
    case '/api/t/access/create': return createAccess(s, who, body);
    case '/api/t/access/revoke': return revokeAccess(s, who, String(body.id || ''));
    case '/api/t/exercises': return { exercises: await s.all('SELECT * FROM exercises WHERE archived = 0 ORDER BY category, title') };
    case '/api/t/exercise/save': return saveExercise(s, who, body);
    case '/api/t/exercise/archive':
      await s.batch([['UPDATE exercises SET archived = 1 WHERE id = ?', [String(body.id || '')]], logRow(who, 'archive', 'exercises', String(body.id || ''), 'archiviert')]);
      return { ok: true };
    case '/api/t/lesson/finish': return finishLesson(s, who, body);
    case '/api/t/import/lessons': return importLessons(s, who, body);
    case '/api/t/assignment/status': {
      const status = body.status === 'erledigt' ? 'erledigt' : 'offen';
      await s.run('UPDATE assignments SET status = ?, done_at = ? WHERE id = ?', status, status === 'erledigt' ? now() : null, String(body.id || ''));
      return { ok: true };
    }
    case '/api/t/assignment/delete':
      await s.run('DELETE FROM assignments WHERE id = ?', String(body.id || ''));
      return { ok: true };
    case '/api/t/feed': return { feed: await s.all('SELECT at, by_role, action, entity, summary FROM log ORDER BY at DESC LIMIT 60') };
  }
  throw new HttpError(404, 'Unbekannte Aktion.');
}

// Schema einmal pro Instanz anlegen (CREATE ... IF NOT EXISTS)
const schemaReady = new WeakMap();
export function ensureSchema(env) {
  let p = schemaReady.get(env.DB);
  if (!p) {
    const stmts = SCHEMA.replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean);
    p = env.DB.batch(stmts.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady.delete(env.DB); throw e; });
    schemaReady.set(env.DB, p);
  }
  return p;
}

export default {
  async fetch(req, env) {
    const url0 = new URL(req.url);
    // Alles außer /api liefert die App aus (Cloudflare Assets)
    if (!url0.pathname.startsWith('/api/') && env.ASSETS) return env.ASSETS.fetch(req);
    await ensureSchema(env);
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      let body = {};
      if (req.method === 'POST') {
        const text = await req.text();
        if (text.length > 100000) throw new HttpError(413, 'Anfrage zu groß.');
        body = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Ungültige Anfrage.');
      }
      return json(await route(env, req, url.pathname, body), 200, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'Serverfehler. Bitte später nochmal.' : e.message }, status, cors);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(() => cleanup(env)));
  },
};
