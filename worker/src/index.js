import { COURSE_SCHEMA, courseData, courseImport } from './course.js';
import { transcribeImage } from './transcribe.js';
import { SONG_SCHEMA, syncSongs, songsHome, songDetail, parseLinkLines, slug, songSuggestions } from './songs.js';
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
// Läuft gerade eine Stunde bei Oti? Dann ist der Schüler im Unterrichtsmodus.
async function lessonLive(s, studentId) {
  const t = now(); const w = await s.first('SELECT until FROM lesson_windows WHERE student_id = ? AND started_at <= ? AND until > ? ORDER BY until DESC LIMIT 1', studentId, t, t);
  return w ? w.until : null;
}
// Eigene Beats eines Schülers, mit Songtitel
function myBeats(s, studentId) {
  return s.all('SELECT b.id, b.song_id, b.title, b.notation, b.created_at, b.updated_at, sg.title AS song_title, o.part_id, o.exercise_id, o.approved_at FROM student_beats b LEFT JOIN songs sg ON sg.id = b.song_id LEFT JOIN student_beat_official o ON o.beat_id = b.id WHERE b.student_id = ? ORDER BY b.updated_at DESC LIMIT 100', studentId);
}
async function studentView(s, studentId, role) {
  const st = await s.first('SELECT id, first_name, birth_year, is_minor, weekday, lesson_time, lesson_minutes, level, instrument FROM students WHERE id = ?', studentId);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const [assignments, sessions, goals, lessons, consent] = await Promise.all([
    s.all(`SELECT a.id, a.exercise_id, a.free_text, CASE WHEN ap.part_id IS NULL AND sb.bpm IS NOT NULL THEN sb.bpm ELSE a.target_bpm END AS target_bpm, sb.bpm AS song_bpm, a.start_bpm, a.minutes_per_day, a.due_date, a.status, a.done_at, a.created_at,
             COALESCE(e.title, psg.title || ': ' || sp.title) AS title, e.category, e.source_type, COALESCE(e.url, sp.url) AS url, e.book_ref, COALESCE(sp.notes, e.notes) AS exercise_notes, COALESCE(spn.notation, e.notation) AS notation, c.student_done_at, x.song_id, x.version AS song_version, ap.part_id
           FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id LEFT JOIN assignment_checks c ON c.assignment_id = a.id LEFT JOIN assignment_songs x ON x.assignment_id = a.id LEFT JOIN assignment_order o ON o.assignment_id = a.id LEFT JOIN assignment_parts ap ON ap.assignment_id = a.id LEFT JOIN song_parts sp ON sp.id = ap.part_id LEFT JOIN songs psg ON psg.id = sp.song_id LEFT JOIN song_part_notation spn ON spn.part_id = ap.part_id LEFT JOIN (SELECT s0.id AS song_id, COALESCE((SELECT bpm FROM song_meta WHERE song_id = s0.id), (SELECT MAX(bpm) FROM song_files WHERE song_id = s0.id)) AS bpm FROM songs s0) sb ON sb.song_id = x.song_id
           WHERE a.student_id = ? AND (a.status = 'offen' OR a.done_at > ?) ORDER BY (o.sort IS NULL) DESC, o.sort, a.created_at DESC`, studentId, new Date(Date.now() - 21 * DAY).toISOString()),
    s.all(`SELECT id, client_id, assignment_id, exercise_id, started_at, local_date, seconds, bpm_reached, feeling, note
           FROM practice_sessions WHERE student_id = ? AND started_at > ? ORDER BY started_at DESC`, studentId, since),
    s.all('SELECT id, title, status, reached_at FROM goals WHERE student_id = ? ORDER BY created_at', studentId),
    s.all('SELECT id, date, minutes, notes_shared FROM lessons WHERE student_id = ? ORDER BY date DESC LIMIT 60', studentId),
    s.first(`SELECT given_at FROM consents WHERE student_id = ? AND kind = 'app' ORDER BY given_at DESC LIMIT 1`, studentId),
  ]);
  const live = await lessonLive(s, studentId);
  const my_beats = await myBeats(s, st.id);
  return { role, student: st, assignments, sessions, goals, lessons, my_beats, lesson_live: live, consent: consent ? consent.given_at : null, consentVersion: CONSENT_VERSION, canGoal: role === 'student' && canSetGoals(st) };
}

// Alle Schüler dürfen eigene Ziele eintragen (Altersgrenze auf Otis Wunsch entfernt)
export function canSetGoals(st) { return !!st; }

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
  // Unterrichtsmodus: Üben während der Stunde zählt nicht als Übungszeit. Beginnt die Sitzung vor der Stunde, zählt nur die Zeit davor.
  let secs = seconds;
  const w = await s.first('SELECT started_at, until FROM lesson_windows WHERE student_id = ? AND until > ? AND started_at < ? ORDER BY started_at LIMIT 1', who.studentId, started, ended);
  if (w) {
    if (started >= w.started_at) return { ok: true, in_lesson: true };
    secs = Math.min(seconds, Math.floor((Date.parse(w.started_at) - Date.parse(started)) / 1000));
    if (secs < 1) return { ok: true, in_lesson: true };
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
      [id, clientId, who.studentId, assignmentId, exerciseId, started, ended, b.local_date, secs, int(b.bpm_reached, 20, 400), int(b.feeling, 1, 5), str(b.note, 500), now()]],
    logRow(who, 'session', 'practice_sessions', id, `${Math.round(secs / 60)} min geübt`),
  ]);
  return secs < seconds ? { id, trimmed: seconds - secs } : { id };
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
  const cancellations = await s.all('SELECT student_id, date, kind FROM cancellations WHERE date >= ?', new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10));
  return { students, cancellations };
}

async function teacherStudent(s, id) {
  const st = await s.first('SELECT * FROM students WHERE id = ?', id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const [lessons, assignments, sessions, goals, access, consents] = await Promise.all([
    s.all('SELECT * FROM lessons WHERE student_id = ? ORDER BY date DESC', id),
    s.all(`SELECT a.*, CASE WHEN ap.part_id IS NULL AND sb.bpm IS NOT NULL THEN sb.bpm ELSE a.target_bpm END AS eff_target, sb.bpm AS song_bpm, COALESCE(e.title, psg.title || ': ' || sp.title) AS title, e.category, e.source_type, COALESCE(e.url, sp.url) AS url, e.book_ref, COALESCE(spn.notation, e.notation) AS notation, e.archived AS ex_archived, c.student_done_at, x.song_id, x.version AS song_version, ap.part_id, sp.title AS part_title FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id
           LEFT JOIN assignment_checks c ON c.assignment_id = a.id LEFT JOIN assignment_songs x ON x.assignment_id = a.id LEFT JOIN assignment_order o ON o.assignment_id = a.id LEFT JOIN assignment_parts ap ON ap.assignment_id = a.id LEFT JOIN song_parts sp ON sp.id = ap.part_id LEFT JOIN songs psg ON psg.id = sp.song_id LEFT JOIN song_part_notation spn ON spn.part_id = ap.part_id LEFT JOIN (SELECT s0.id AS song_id, COALESCE((SELECT bpm FROM song_meta WHERE song_id = s0.id), (SELECT MAX(bpm) FROM song_files WHERE song_id = s0.id)) AS bpm FROM songs s0) sb ON sb.song_id = x.song_id
           WHERE a.student_id = ? ORDER BY (o.sort IS NULL) DESC, o.sort, a.created_at DESC LIMIT 200`, id),
    s.all('SELECT id, assignment_id, exercise_id, started_at, local_date, seconds, bpm_reached, feeling, note FROM practice_sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT 400', id),
    s.all('SELECT * FROM goals WHERE student_id = ? ORDER BY created_at', id),
    s.all(`SELECT a.id, a.role, a.label, a.created_at, a.revoked_at,
             (SELECT MAX(d.last_seen) FROM devices d WHERE d.access_id = a.id) AS last_seen
           FROM access a WHERE a.student_id = ? ORDER BY a.created_at`, id),
    s.all('SELECT id, access_id, kind, version_text, given_at FROM consents WHERE student_id = ? ORDER BY given_at DESC', id),
  ]);
  const worship = !!(await s.first('SELECT 1 AS w FROM worship_students WHERE student_id = ?', id));
  const cancellations = await s.all('SELECT id, date, kind, note, created_at FROM cancellations WHERE student_id = ? ORDER BY date DESC', id);
  for (const a of assignments) { a.target_bpm = a.eff_target; delete a.eff_target; }
  const beats = await myBeats(s, st.id);
  return { student: st, lessons, assignments, sessions, goals, access, consents, worship, cancellations, beats };
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
    ['DELETE FROM assignment_songs WHERE assignment_id IN (SELECT id FROM assignments WHERE student_id = ?)', [id]],
    ['DELETE FROM assignment_checks WHERE assignment_id IN (SELECT id FROM assignments WHERE student_id = ?)', [id]],
    ['DELETE FROM assignment_order WHERE assignment_id IN (SELECT id FROM assignments WHERE student_id = ?)', [id]],
    ['DELETE FROM student_beat_official WHERE beat_id IN (SELECT id FROM student_beats WHERE student_id = ?)', [id]],
    ['DELETE FROM student_beats WHERE student_id = ?', [id]],
    ['DELETE FROM devices WHERE access_id IN (SELECT id FROM access WHERE student_id = ?)', [id]],
    ['DELETE FROM access WHERE student_id = ?', [id]],
    ['DELETE FROM consents WHERE student_id = ?', [id]],
    ['DELETE FROM practice_sessions WHERE student_id = ?', [id]],
    ['DELETE FROM lesson_windows WHERE student_id = ?', [id]],
    ['DELETE FROM assignments WHERE student_id = ?', [id]],
    ['DELETE FROM goals WHERE student_id = ?', [id]],
    ['DELETE FROM lessons WHERE student_id = ?', [id]],
    ['DELETE FROM student_songs WHERE student_id = ?', [id]],
    ['DELETE FROM student_lessons WHERE student_id = ?', [id]],
    ['DELETE FROM cancellations WHERE student_id = ?', [id]],
    ['DELETE FROM worship_students WHERE student_id = ?', [id]],
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

// Link (z. B. YouTube) an eine Hausaufgabe hängen: legt eine eigene Übung dafür an
function sourceFor(url) { return /youtu\.?be/i.test(url) ? 'youtube' : /instagram\.com/i.test(url) ? 'instagram' : /drive\.google\.com/i.test(url) ? 'drive' : /musora\.com|drumeo\.com|guitareo\.com/i.test(url) ? 'musora' : 'link'; }
function cleanUrl(u) {
  let url = str(u, 500);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/^http:/i, 'https:');
  try { new URL(url); } catch { throw new HttpError(400, 'Das sieht nicht wie ein Link aus.'); }
  return url;
}
async function linkAssignment(s, who, b) {
  const a = await s.first('SELECT a.id, a.free_text, a.exercise_id, e.title FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id WHERE a.id = ?', String(b.id || ''));
  if (!a) throw new HttpError(404, 'Hausaufgabe nicht gefunden.');
  const url = cleanUrl(b.url);
  if (!url) throw new HttpError(400, 'Link fehlt.');
  const exId = uid();
  await s.batch([
    ['INSERT INTO exercises (id, title, category, source_type, url, archived, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', [exId, str(a.title || a.free_text, 120) || 'Übung', 'Hausaufgaben', sourceFor(url), url, now()]],
    ['UPDATE assignments SET exercise_id = ? WHERE id = ?', [exId, a.id]],
    logRow(who, 'update', 'assignments', a.id, 'Link ergänzt'),
  ]);
  return { ok: true, exercise_id: exId, url };
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

// Namen in der Bibliothek sind eindeutig (Groß und Kleinschreibung und Leerzeichen egal)
const normTitle = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
async function assertFreeTitle(s, title, exceptId = '') {
  const want = normTitle(title);
  const rows = await s.all('SELECT id, title FROM exercises WHERE archived = 0 AND id != ?', exceptId || '');
  const hit = rows.find((r) => normTitle(r.title) === want);
  if (hit) throw new HttpError(409, `Den Namen „${hit.title}“ gibt es schon in der Bibliothek. Bitte wähle einen anderen.`);
}

async function saveExercise(s, who, b) {
  const title = str(b.title, 120);
  if (!title) throw new HttpError(400, 'Titel fehlt.');
  await assertFreeTitle(s, title, b.id);
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
  const sig = ['4/4', '3/4', '6/8', '12/8'].includes(o.sig) ? o.sig : '4/4';
  const bars = int(o.bars, 1, 16) || 1;
  const steps = ({ '3/4': 12, '6/8': 12, '12/8': 24 }[sig] || 16) * bars;
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
  const stick = {};
  for (const [k, v] of Object.entries(o.stick && typeof o.stick === 'object' ? o.stick : {})) {
    const i = Number(k); if (Number.isInteger(i) && i >= 0 && i < steps && (v === 'R' || v === 'L' || v === 'K')) stick[i] = v;
  }
  const dyn = {};
  for (const [key, v] of Object.entries(o.dyn && typeof o.dyn === 'object' ? o.dyn : {})) {
    const [k, i] = String(key).split(':'); const n = Number(i);
    if ((v === 'a' || v === 's') && tracks[k] && tracks[k].includes(n)) dyn[k + ':' + n] = v;
  }
  const flam = {};
  for (const [key, v] of Object.entries(o.flam && typeof o.flam === 'object' ? o.flam : {})) {
    const [k, i] = String(key).split(':'); const n = Number(i);
    if (v && tracks[k] && tracks[k].includes(n)) flam[k + ':' + n] = 1;
  }
  return JSON.stringify({ v: 2, sig, bars, bpm: int(o.bpm, 30, 300) || 80, tracks, stick, dyn, ...(Object.keys(flam).length ? { flam } : {}), marks, repeat });
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

// Notizen zusammenführen: neue Zeilen anhängen, doppelte Zeilen weglassen
export function mergeNotes(a, b) {
  if (!a) return b || null; if (!b) return a;
  const have = new Set(a.split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const add = b.split('\n').filter((x) => x.trim() && !have.has(x.trim().toLowerCase()));
  return (add.length ? a + '\n' + add.join('\n') : a).slice(0, 3000);
}

// Neue Hausaufgaben hinten anhängen: aktuelle Anzeige Reihenfolge festschreiben, dann die neuen in ihrer Reihenfolge dahinter
async function orderAppend(s, studentId, newIds) {
  if (!newIds.length) return [];
  const rows = await s.all("SELECT a.id FROM assignments a LEFT JOIN assignment_order o ON o.assignment_id = a.id WHERE a.student_id = ? AND a.status = 'offen' ORDER BY (o.sort IS NULL) DESC, o.sort, a.created_at DESC", studentId);
  return rows.map((x) => x.id).filter((x) => !newIds.includes(x)).concat(newIds)
    .map((x, i) => ['INSERT INTO assignment_order (assignment_id, sort) VALUES (?, ?) ON CONFLICT(assignment_id) DO UPDATE SET sort = excluded.sort', [x, i]]);
}
// Neue Hausaufgaben anlegen (in der Stunde sofort oder beim Beenden). Schreibt in stmts, liefert neue IDs und übersprungene Titel.
async function newAssignmentStatements(s, st, lessonId, items, closing, t, stmts) {
  const skipped = [];
  // Kleinschreibung in JS, weil SQLite LOWER keine Umlaute kennt
  const openRows = (await s.all("SELECT a.id, a.exercise_id, a.free_text, x.song_id, x.version, ap.part_id FROM assignments a LEFT JOIN assignment_songs x ON x.assignment_id = a.id LEFT JOIN assignment_parts ap ON ap.assignment_id = a.id WHERE a.student_id = ? AND a.status = 'offen'", st.id)).map((r) => ({ ...r, ft: (r.free_text || '').trim().toLowerCase() }));
  // Song Hausaufgaben: gleicher Song in einer anderen Version (Original, Reel, …) ist erlaubt. Bausteine zählen nicht als Song.
  const songKey = (id, v) => id + '|' + String(v || '').trim().toLowerCase();
  const openSongs = new Set(openRows.filter((r) => !closing.has(r.id) && r.song_id && !r.part_id).map((r) => songKey(r.song_id, r.version)));
  const openEx = new Set(openRows.filter((r) => !closing.has(r.id) && r.exercise_id).map((r) => r.exercise_id));
  const openFt = new Set(openRows.filter((r) => !closing.has(r.id) && r.ft).map((r) => r.ft));
  const openParts = new Set(openRows.filter((r) => !closing.has(r.id) && r.part_id).map((r) => r.part_id));
  const newIds = [];
  for (const a of (Array.isArray(items) ? items : []).slice(0, 20)) {
    // Song Baustein: verlinkt (Noten bleiben im Song), Tempo 45 bis Original Tempo
    if (a.part_id) {
      const part = await s.first('SELECT p.id, p.song_id, p.title, sg.title AS song_title, COALESCE((SELECT bpm FROM song_meta WHERE song_id = sg.id), (SELECT MAX(bpm) FROM song_files WHERE song_id = sg.id)) AS song_bpm FROM song_parts p JOIN songs sg ON sg.id = p.song_id WHERE p.id = ?', str(a.part_id, 64));
      if (!part) continue;
      const title = part.song_title + ': ' + part.title;
      if (openParts.has(part.id)) { skipped.push(title); continue; }
      openParts.add(part.id);
      const aid = uid(); newIds.push(aid);
      stmts.push(['INSERT INTO assignment_songs (assignment_id, song_id, version) VALUES (?, ?, ?)', [aid, part.song_id, str(a.version, 40)]], ['INSERT INTO assignment_parts (assignment_id, part_id) VALUES (?, ?)', [aid, part.id]],
        ['INSERT INTO assignments (id, student_id, lesson_id, exercise_id, free_text, target_bpm, start_bpm, minutes_per_day, due_date, status, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)',
          [aid, st.id, lessonId, title, int(a.target_bpm, 20, 400) || part.song_bpm || null, int(a.start_bpm, 20, 400) || 45, int(a.minutes_per_day, 1, 240) || 10, isDate(a.due_date) ? a.due_date : null, 'offen', t]]);
      continue;
    }
    let exId = str(a.exercise_id, 64);
    if (exId && !(await s.first('SELECT id FROM exercises WHERE id = ?', exId))) exId = null;
    const songId = str(a.song_id, 200);
    const song = songId ? await s.first('SELECT id, title FROM songs WHERE id = ?', songId) : null;
    const free = song ? str((song.title + (a.version ? ' (' + a.version + ')' : '')), 300) : str(a.free_text, 300);
    if (!exId && !free) continue;
    if (song && openSongs.has(songKey(song.id, a.version))) { skipped.push(free); continue; }
    if (song) { openSongs.add(songKey(song.id, a.version)); exId = null; }
    // Keine doppelte Hausaufgabe: gleiche Übung oder gleicher Text ist schon offen
    const ft = (free || '').trim().toLowerCase();
    if (!a.notation && !song && ((exId && openEx.has(exId)) || (!exId && ft && openFt.has(ft)))) { skipped.push(free || exId); continue; }
    if (exId) openEx.add(exId); if (ft) openFt.add(ft);
    // Beat direkt in der Stunde geschrieben: eigene Übung mit Noten anlegen (Bibliothek nur auf Wunsch)
    const beat = !exId && a.notation ? cleanNotation(a.notation) : null;
    if (beat) {
      if (a.save_library) await assertFreeTitle(s, (free || 'Beat').slice(0, 120));
      exId = uid();
      stmts.push(['INSERT INTO exercises (id, title, category, source_type, target_bpm, notation, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [exId, (free || 'Beat').slice(0, 120), a.save_library ? 'Eigene Beats' : 'Hausaufgaben', 'noten', int(a.target_bpm, 20, 400), beat, a.save_library ? 0 : 1, t]]);
    }
    const link = cleanUrl(a.url);
    if (!exId && link) {
      exId = uid();
      stmts.push(['INSERT INTO exercises (id, title, category, source_type, url, archived, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', [exId, free.slice(0, 120), 'Hausaufgaben', sourceFor(link), link, t]]);
    }
    const aid = uid(); newIds.push(aid);
    if (song) stmts.push(['INSERT INTO assignment_songs (assignment_id, song_id, version) VALUES (?, ?, ?)', [aid, song.id, str(a.version, 40)]]);
    stmts.push(['INSERT INTO assignments (id, student_id, lesson_id, exercise_id, free_text, target_bpm, start_bpm, minutes_per_day, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [aid, st.id, lessonId, exId, free, int(a.target_bpm, 20, 400), song ? null : int(a.start_bpm, 20, 400), int(a.minutes_per_day, 1, 240), isDate(a.due_date) ? a.due_date : null, 'offen', t]]);
  }
  return { newIds, skipped };
}
async function finishLesson(s, who, b) {
  const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', b.student_id);
  if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
  const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const t = now();
  // Gibt es am selben Tag schon eine Stunde, wird sie ergänzt statt doppelt angelegt
  const same = await s.first('SELECT id, minutes, notes_teacher, notes_shared FROM lessons WHERE student_id = ? AND date = ? ORDER BY created_at DESC LIMIT 1', st.id, date);
  const lessonId = same ? same.id : uid();
  const stmts = [same
    ? ['UPDATE lessons SET minutes = ?, notes_teacher = ?, notes_shared = ? WHERE id = ?', [Math.max(same.minutes || 0, int(b.minutes, 5, 240) || 0) || null, mergeNotes(same.notes_teacher, str(b.notes_teacher, 3000)), mergeNotes(same.notes_shared, str(b.notes_shared, 3000)), same.id]]
    : ['INSERT INTO lessons (id, student_id, date, minutes, notes_teacher, notes_shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [lessonId, st.id, date, int(b.minutes, 5, 240), str(b.notes_teacher, 3000), str(b.notes_shared, 3000), t]]];
  const closing = new Set((Array.isArray(b.close_assignments) ? b.close_assignments : []).map(String));
  const { newIds, skipped } = await newAssignmentStatements(s, st, lessonId, b.new_assignments, closing, t, stmts);
  // In der Stunde sofort gespeicherte Hausaufgaben dieser Stunde zuordnen
  for (const id of (Array.isArray(b.attach_assignments) ? b.attach_assignments : []).slice(0, 50)) stmts.push(['UPDATE assignments SET lesson_id = ? WHERE id = ? AND student_id = ? AND lesson_id IS NULL', [lessonId, String(id), st.id]]);
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
  stmts.push(['UPDATE lesson_windows SET until = ? WHERE student_id = ? AND until > ?', [t, st.id, t]]);
  stmts.push(logRow(who, 'lesson', 'lessons', lessonId, `Stunde mit ${st.first_name}${same ? ' (ergänzt)' : ''}`));
  await s.batch(stmts);
  const ord = await orderAppend(s, st.id, newIds); if (ord.length) await s.batch(ord);
  return { id: lessonId, merged: !!same, skipped };
}

// ---------- Aufräumen (täglich) ----------
export async function cleanup(env) {
  const s = store(env);
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString();
  const old = await s.all("SELECT id FROM students WHERE status = 'archiviert' AND archived_at < ?", yearAgo);
  for (const r of old) await s.batch(deleteStudentStatements(r.id));
  await s.run('DELETE FROM devices WHERE expires_at < ?', now());
  await s.run('DELETE FROM lesson_windows WHERE until < ?', new Date(Date.now() - 30 * DAY).toISOString());
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
  if (path === '/api/songs') return songsHome(s, who);
  if (path === '/api/course') return courseData(s, 'drums', who.role === 'teacher' ? (str(body.student_id, 64) || null) : who.studentId, who.role === 'teacher');
  if (path === '/api/song') { const d = await songDetail(s, body.id, who.role === 'teacher'); if (!d) throw new HttpError(404, 'Song nicht gefunden.'); return d; }
  if (path === '/api/my/song') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler haben eine eigene Setlist.');
    const sid = String(body.song_id || '');
    if (!(await s.first('SELECT id FROM songs WHERE id = ?', sid))) throw new HttpError(404, 'Song nicht gefunden.');
    if (body.on) await s.run('INSERT OR IGNORE INTO student_songs (student_id, song_id, added_at) VALUES (?, ?, ?)', who.studentId, sid, now());
    else await s.run('DELETE FROM student_songs WHERE student_id = ? AND song_id = ?', who.studentId, sid);
    return { ok: true };
  }
  if (path === '/api/my/beat/save' || path === '/api/my/beat/delete') {
    // Schüler schreiben eigene Beats oder Bausteine (optional zu einem Song). Nur der Schüler selbst und Oti sehen sie.
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler schreiben eigene Beats.');
    if (path === '/api/my/beat/delete') { await s.batch([['DELETE FROM student_beat_official WHERE beat_id IN (SELECT id FROM student_beats WHERE id = ? AND student_id = ?)', [String(body.id || ''), who.studentId]], ['DELETE FROM student_beats WHERE id = ? AND student_id = ?', [String(body.id || ''), who.studentId]]]); return { ok: true }; }
    const title = str(body.title, 80); if (!title) throw new HttpError(400, 'Gib deinem Beat einen Namen.');
    const nt = cleanNotation(body.notation); const no = nt && JSON.parse(nt); if (!no || no.kind || !Object.values(no.tracks).some((t) => t.length)) throw new HttpError(400, 'Schreib zuerst ein paar Noten.');
    const songId = body.song_id ? String(body.song_id) : null;
    if (songId && !(await s.first('SELECT id FROM songs WHERE id = ?', songId))) throw new HttpError(404, 'Song nicht gefunden.');
    const t = now();
    if (body.id) {
      const b = await s.first('SELECT id FROM student_beats WHERE id = ? AND student_id = ?', String(body.id), who.studentId);
      if (!b) throw new HttpError(404, 'Beat nicht gefunden.');
      await s.run('UPDATE student_beats SET title = ?, song_id = ?, notation = ?, updated_at = ? WHERE id = ?', title, songId, nt, t, b.id);
      return { id: b.id };
    }
    const n = (await s.first('SELECT COUNT(*) AS n FROM student_beats WHERE student_id = ?', who.studentId)).n;
    if (n >= 100) throw new HttpError(400, 'Du hast schon 100 Beats. Lösch erst einen alten.');
    const id = uid(); await s.run('INSERT INTO student_beats (id, student_id, song_id, title, notation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, who.studentId, songId, title, nt, t, t);
    return { id };
  }
  if (path === '/api/goal/add' || path === '/api/goal/toggle') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler tragen eigene Ziele ein.');
    const st = await s.first('SELECT birth_year FROM students WHERE id = ?', who.studentId);
    if (!st || !canSetGoals(st)) throw new HttpError(403, 'Kein Zugriff.');
    if (path === '/api/goal/add') {
      const title = str(body.title, 160); if (!title) throw new HttpError(400, 'Ziel fehlt.');
      const n = (await s.first("SELECT COUNT(*) AS n FROM goals WHERE student_id = ? AND status = 'offen'", who.studentId)).n;
      if (n >= 20) throw new HttpError(400, 'Höchstens 20 offene Ziele.');
      const id = uid();
      await s.batch([['INSERT INTO goals (id, student_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)', [id, who.studentId, title, 'offen', now()]], logRow(who, 'create', 'goals', id, 'Eigenes Ziel: ' + title)]);
      return { id };
    }
    const g = await s.first('SELECT id, status FROM goals WHERE id = ? AND student_id = ?', String(body.id || ''), who.studentId);
    if (!g) throw new HttpError(404, 'Ziel nicht gefunden.');
    const done = g.status !== 'erreicht';
    await s.run('UPDATE goals SET status = ?, reached_at = ? WHERE id = ?', done ? 'erreicht' : 'offen', done ? now() : null, g.id);
    return { ok: true, status: done ? 'erreicht' : 'offen' };
  }
  if (path === '/api/lesson/live') {
    if (!own) throw new HttpError(403, 'Kein Zugriff.');
    return { until: await lessonLive(s, who.studentId) };
  }
  if (path === '/api/session/add') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler können Übezeit eintragen.');
    return addSession(s, who, body);
  }
  if (path === '/api/assignment/toggle') {
    if (who.role !== 'student') throw new HttpError(403, 'Nur Schüler können Hausaufgaben abhaken.');
    const a = await s.first('SELECT id, status FROM assignments WHERE id = ? AND student_id = ?', String(body.id || ''), who.studentId);
    if (!a) throw new HttpError(403, 'Diese Hausaufgabe gehört nicht zu dir.');
    // Der Schüler hakt nur für sich ab; schließen kann die Hausaufgabe nur der Lehrer
    const done = !!body.done;
    await s.batch([
      done ? ['INSERT OR REPLACE INTO assignment_checks (assignment_id, student_done_at) VALUES (?, ?)', [a.id, now()]] : ['DELETE FROM assignment_checks WHERE assignment_id = ?', [a.id]],
      logRow(who, done ? 'done' : 'undone', 'assignments', a.id, done ? 'Schüler hat abgehakt' : 'Schüler Haken entfernt'),
    ]);
    return { ok: true, student_done: done };
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
    case '/api/t/songs/sync': return syncSongs(env);
    case '/api/t/cancel': {
      const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', String(body.student_id || ''));
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
      if (body.undo) { await s.run('DELETE FROM cancellations WHERE student_id = ? AND date = ?', st.id, date); return { ok: true }; }
      const kind = ['schueler', 'kurzfristig', 'lehrer'].includes(body.kind) ? body.kind : 'schueler';
      const id = uid();
      await s.batch([
        ['INSERT INTO cancellations (id, student_id, date, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(student_id, date) DO UPDATE SET kind = excluded.kind, note = excluded.note', [id, st.id, date, kind, str(body.note, 300), now()]],
        logRow(who, 'cancel', 'cancellations', id, `${st.first_name}: abgesagt (${kind})`),
      ]);
      return { ok: true };
    }
    case '/api/t/song/create': {
      // Song aus dem Unterricht, der nicht im Lobpreis Ordner liegt
      const title = str(body.title, 160); if (!title) throw new HttpError(400, 'Titel fehlt.');
      const id = 'unterricht:' + slug(title);
      await s.run("INSERT INTO songs (id, title, lang, updated_at) VALUES (?, ?, 'unterricht', ?) ON CONFLICT(id) DO NOTHING", id, title, now());
      return { id };
    }
    case '/api/t/song/teaching': {
      // Song in den Reiter Unterricht aufnehmen, entfernen, als Vorschlag ausblenden oder Kategorie setzen
      const song = await s.first('SELECT id FROM songs WHERE id = ?', String(body.song_id || ''));
      if (!song) throw new HttpError(404, 'Song nicht gefunden.');
      const cur = await s.first('SELECT state, kind FROM song_teaching WHERE song_id = ?', song.id) || {};
      const state = body.state === undefined ? cur.state || null : ({ on: 'on', hidden: 'hidden', off: null })[body.state];
      if (body.state !== undefined && state === undefined) throw new HttpError(400, 'Unbekannter Status.');
      const kind = body.kind === undefined ? cur.kind || null : (['worship', 'andere'].includes(body.kind) ? body.kind : null);
      await s.run('INSERT INTO song_teaching (song_id, state, kind, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET state = excluded.state, kind = excluded.kind, updated_at = excluded.updated_at', song.id, state, kind, now());
      return { ok: true, state, kind };
    }
    case '/api/t/songs/suggest': return { suggestions: await songSuggestions(s) };
    case '/api/t/song/links/add': {
      const song = await s.first('SELECT id FROM songs WHERE id = ?', String(body.song_id || ''));
      if (!song) throw new HttpError(404, 'Song nicht gefunden.');
      const items = parseLinkLines(body.lines, str(body.version, 40) || 'Original');
      if (!items.length) throw new HttpError(400, 'Kein Link gefunden. Eine Zeile pro Link, z. B. "Easy | https://youtu.be/…".');
      const n = (await s.first('SELECT COUNT(*) AS n FROM song_links WHERE song_id = ?', song.id)).n;
      await s.batch(items.map((it, i) => ['INSERT INTO song_links (id, song_id, version, title, url, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid(), song.id, it.version, null, cleanUrl(it.url), n + i, now()]]).concat([logRow(who, 'create', 'song_links', song.id, items.length + ' Links')]));
      return { added: items.length };
    }
    case '/api/t/song/link/update': {
      const l = await s.first('SELECT id FROM song_links WHERE id = ?', String(body.id || ''));
      if (!l) throw new HttpError(404, 'Video nicht gefunden.');
      const version = str(body.version, 40); if (!version) throw new HttpError(400, 'Version fehlt.');
      await s.batch([['UPDATE song_links SET version = ?, title = ? WHERE id = ?', [version, str(body.title, 120), l.id]], logRow(who, 'update', 'song_links', l.id, version)]);
      return { ok: true };
    }
    case '/api/t/song/link/delete': await s.run('DELETE FROM song_links WHERE id = ?', String(body.id || '')); return { ok: true };
    case '/api/t/song/candidates': {
      // Mögliche Songs aus freien Hausaufgaben Texten; Oti entscheidet selbst, was ein Song ist
      const rows = await s.all("SELECT TRIM(free_text) AS t, COUNT(*) AS n FROM assignments WHERE free_text IS NOT NULL AND TRIM(free_text) != '' GROUP BY LOWER(TRIM(free_text)) ORDER BY n DESC LIMIT 400");
      const known = new Set((await s.all('SELECT title FROM songs')).map((r) => slug(r.title)));
      return { candidates: rows.filter((r) => r.t.length <= 80 && !known.has(slug(r.t))) };
    }
    case '/api/t/consent': {
      // Einwilligung der Eltern, die Oti außerhalb der App bekommen hat (schriftlich oder per Nachricht)
      const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', String(body.student_id || ''));
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      const how = str(body.how, 120) || 'den Eltern eingeholt';
      const id = uid();
      await s.batch([
        ["INSERT INTO consents (id, student_id, access_id, kind, version_text, given_at) VALUES (?, ?, 'lehrer', 'app', ?, ?)", [id, st.id, CONSENT_VERSION + ' · von Oti bestätigt: ' + how, now()]],
        logRow(who, 'consent', 'consents', id, 'Einwilligung von Oti eingetragen für ' + st.first_name),
      ]);
      return { ok: true };
    }
    case '/api/t/course/import':
      try { return await courseImport(s, body, now, uid); } catch (e) { if (e.status) throw new HttpError(e.status, e.message); throw e; }
    case '/api/t/course/lesson/save': {
      const l = await s.first('SELECT id FROM course_lessons WHERE id = ?', String(body.id || ''));
      if (!l) throw new HttpError(404, 'Lektion nicht gefunden.');
      const title = str(body.title, 120); if (!title) throw new HttpError(400, 'Titel fehlt.');
      await s.run('UPDATE course_lessons SET title = ?, body = ?, level = COALESCE(?, level), num = COALESCE(?, num) WHERE id = ?', title, str(body.body, 2000), int(body.level, 1, 20), int(body.num, 1, 500), l.id);
      return { ok: true };
    }
    case '/api/t/course/item/save': {
      const l = await s.first('SELECT id FROM course_lessons WHERE id = ?', String(body.lesson_id || ''));
      if (!l) throw new HttpError(404, 'Lektion nicht gefunden.');
      const kind = ['video', 'song', 'text', 'material', 'exercise'].includes(body.kind) ? body.kind : 'video';
      const title = str(body.title, 160) || str(body.song_title, 160); if (!title) throw new HttpError(400, 'Titel fehlt.');
      let url = kind === 'video' ? cleanUrl(body.url) : null;
      if (kind === 'exercise') {
        const ex = await s.first('SELECT id FROM exercises WHERE id = ?', String(body.exercise_id || ''));
        if (!ex) throw new HttpError(404, 'Übung nicht gefunden.');
        url = ex.id;
      }
      if (kind === 'video' && !url) throw new HttpError(400, 'Link fehlt.');
      const n = (await s.first('SELECT COUNT(*) AS n FROM lesson_items WHERE lesson_id = ?', l.id)).n;
      const id = uid();
      await s.run('INSERT INTO lesson_items (id, lesson_id, kind, title, url, song_title, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, l.id, kind, title, url, kind === 'song' ? (str(body.song_title, 160) || title) : null, str(body.notes, 500), n);
      return { id };
    }
    case '/api/t/course/level/remove': {
      // Leeres Level entfernen, die Level darüber rücken eins nach unten
      const course = 'drums', level = int(body.level, 1, 20);
      if (!level) throw new HttpError(400, 'Level fehlt.');
      if ((await s.first('SELECT COUNT(*) AS n FROM course_lessons WHERE course = ? AND level = ?', course, level)).n) throw new HttpError(409, 'In diesem Level sind noch Lektionen.');
      await s.batch([
        ['DELETE FROM course_levels WHERE course = ? AND level = ?', [course, level]],
        ['UPDATE course_levels SET level = level - 1 WHERE course = ? AND level > ?', [course, level]],
        ['UPDATE course_lessons SET level = level - 1 WHERE course = ? AND level > ?', [course, level]],
        logRow(who, 'update', 'course_levels', String(level), 'Level entfernt'),
      ]);
      return { ok: true };
    }
    case '/api/t/course/item/delete': await s.run('DELETE FROM lesson_items WHERE id = ?', String(body.id || '')); return { ok: true };
    case '/api/t/course/assign': {
      const sid = String(body.student_id || ''), lid = String(body.lesson_id || '');
      if (!(await s.first('SELECT id FROM students WHERE id = ?', sid)) || !(await s.first('SELECT id FROM course_lessons WHERE id = ?', lid))) throw new HttpError(404, 'Schüler oder Lektion nicht gefunden.');
      if (body.status === 'offen' || body.status === 'fertig') {
        await s.run(`INSERT INTO student_lessons (student_id, lesson_id, status, assigned_at, done_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(student_id, lesson_id) DO UPDATE SET status = excluded.status, done_at = excluded.done_at`, sid, lid, body.status, now(), body.status === 'fertig' ? now() : null);
      } else await s.run('DELETE FROM student_lessons WHERE student_id = ? AND lesson_id = ?', sid, lid);
      return { ok: true };
    }
    case '/api/t/student/worship': {
      const id = String(body.id || '');
      if (body.on) await s.run('INSERT OR IGNORE INTO worship_students (student_id) VALUES (?)', id); else await s.run('DELETE FROM worship_students WHERE student_id = ?', id);
      return { ok: true };
    }
    case '/api/t/song/part/save': {
      const song = await s.first('SELECT id FROM songs WHERE id = ?', String(body.song_id || ''));
      if (!song) throw new HttpError(404, 'Song nicht gefunden.');
      const title = str(body.title, 120); if (!title) throw new HttpError(400, 'Titel fehlt.');
      const url = cleanUrl(body.url);
      const n = (await s.first('SELECT COUNT(*) AS n FROM song_parts WHERE song_id = ?', song.id)).n;
      const id = uid();
      const nt = cleanNotation(body.notation);
      const ops = [['INSERT INTO song_parts (id, song_id, title, url, notes, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, song.id, title, url, str(body.notes, 500), n, now()]], logRow(who, 'create', 'song_parts', id, title)];
      if (nt) ops.push(['INSERT INTO song_part_notation (part_id, notation) VALUES (?, ?)', [id, nt]]);
      const ver = str(body.version, 40); if (ver) ops.push(['INSERT INTO song_part_version (part_id, version) VALUES (?, ?)', [id, ver]]);
      await s.batch(ops);
      return { id };
    }
    case '/api/t/song/bpm': {
      const sg = await s.first('SELECT id, title FROM songs WHERE id = ?', String(body.song_id || ''));
      if (!sg) throw new HttpError(404, 'Song nicht gefunden.');
      const bpm = int(body.bpm, 30, 300);
      await s.batch([bpm ? ['INSERT INTO song_meta (song_id, bpm, bpm_source) VALUES (?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET bpm = excluded.bpm, bpm_source = excluded.bpm_source', [sg.id, bpm, str(body.source, 200) || 'Oti']] : ['DELETE FROM song_meta WHERE song_id = ?', [sg.id]],
        logRow(who, 'update', 'songs', sg.id, 'BPM ' + (bpm || 'gelöscht'))]);
      return { ok: true };
    }
    case '/api/t/student/beat/approve': {
      // Oti bestätigt einen Schüler Beat: mit Song wird er offizieller Song Baustein, ohne Song eine Bibliotheksübung
      const b = await s.first('SELECT b.*, st.first_name, o.beat_id AS done FROM student_beats b JOIN students st ON st.id = b.student_id LEFT JOIN student_beat_official o ON o.beat_id = b.id WHERE b.id = ?', String(body.id || ''));
      if (!b) throw new HttpError(404, 'Beat nicht gefunden.');
      if (b.done) throw new HttpError(409, 'Schon übernommen.');
      const title = str(body.title, 120) || b.title; const t = now(); const ops = []; let partId = null, exId = null;
      if (b.song_id) {
        partId = uid(); const n = (await s.first('SELECT COUNT(*) AS n FROM song_parts WHERE song_id = ?', b.song_id)).n;
        ops.push(['INSERT INTO song_parts (id, song_id, title, url, notes, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [partId, b.song_id, title, null, 'Geschrieben von ' + b.first_name, n, t]],
          ['INSERT INTO song_part_notation (part_id, notation) VALUES (?, ?)', [partId, b.notation]]);
        const ver = str(body.version, 40); if (ver) ops.push(['INSERT INTO song_part_version (part_id, version) VALUES (?, ?)', [partId, ver]]);
      } else {
        await assertFreeTitle(s, title); exId = uid();
        ops.push(['INSERT INTO exercises (id, title, category, source_type, notes, notation, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', [exId, title, 'Schüler Beats', 'noten', 'Geschrieben von ' + b.first_name, b.notation, t]]);
      }
      ops.push(['INSERT INTO student_beat_official (beat_id, part_id, exercise_id, approved_at) VALUES (?, ?, ?, ?)', [b.id, partId, exId, t]], logRow(who, 'create', partId ? 'song_parts' : 'exercises', partId || exId, 'Schüler Beat übernommen: ' + title));
      await s.batch(ops); return { part_id: partId, exercise_id: exId };
    }
    case '/api/t/song/part/update': {
      const p = await s.first('SELECT id FROM song_parts WHERE id = ?', String(body.id || ''));
      if (!p) throw new HttpError(404, 'Baustein nicht gefunden.');
      const title = str(body.title, 120); if (!title) throw new HttpError(400, 'Titel fehlt.');
      const nt = cleanNotation(body.notation);
      const ops = [['UPDATE song_parts SET title = ?, url = ?, notes = ? WHERE id = ?', [title, cleanUrl(body.url), str(body.notes, 500), p.id]]];
      ops.push(nt ? ['INSERT INTO song_part_notation (part_id, notation) VALUES (?, ?) ON CONFLICT(part_id) DO UPDATE SET notation = excluded.notation', [p.id, nt]] : ['DELETE FROM song_part_notation WHERE part_id = ?', [p.id]]);
      if (body.version !== undefined) { const ver = str(body.version, 40); ops.push(ver ? ['INSERT INTO song_part_version (part_id, version) VALUES (?, ?) ON CONFLICT(part_id) DO UPDATE SET version = excluded.version', [p.id, ver]] : ['DELETE FROM song_part_version WHERE part_id = ?', [p.id]]); }
      ops.push(logRow(who, 'update', 'song_parts', p.id, title)); await s.batch(ops); return { ok: true };
    }
    case '/api/t/song/part/sync': {
      // Baustein auf Wunsch in eine andere Version übernehmen: gleichnamigen Baustein dort überschreiben, sonst neu anlegen
      const p = await s.first('SELECT p.id, p.song_id, p.title, p.url, p.notes, n.notation, v.version FROM song_parts p LEFT JOIN song_part_notation n ON n.part_id = p.id LEFT JOIN song_part_version v ON v.part_id = p.id WHERE p.id = ?', String(body.id || ''));
      if (!p) throw new HttpError(404, 'Baustein nicht gefunden.');
      const ver = str(body.version, 40); if (!ver || ver === p.version) throw new HttpError(400, 'Andere Version wählen.');
      const base = (t) => String(t || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      const title = p.version && p.title.endsWith('(' + p.version + ')') ? p.title.slice(0, -(p.version.length + 2)).trim() + ' (' + ver + ')' : p.title;
      const twin = (await s.all('SELECT p.id, p.title FROM song_parts p JOIN song_part_version v ON v.part_id = p.id WHERE p.song_id = ? AND v.version = ?', p.song_id, ver)).find((x) => base(x.title) === base(p.title));
      const ops = []; let tid;
      if (twin) { tid = twin.id; ops.push(['UPDATE song_parts SET url = ?, notes = ? WHERE id = ?', [p.url, p.notes, tid]]); }
      else {
        tid = uid(); const n = (await s.first('SELECT COUNT(*) AS n FROM song_parts WHERE song_id = ?', p.song_id)).n;
        ops.push(['INSERT INTO song_parts (id, song_id, title, url, notes, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [tid, p.song_id, title, p.url, p.notes, n, now()]], ['INSERT INTO song_part_version (part_id, version) VALUES (?, ?)', [tid, ver]]);
      }
      ops.push(p.notation ? ['INSERT INTO song_part_notation (part_id, notation) VALUES (?, ?) ON CONFLICT(part_id) DO UPDATE SET notation = excluded.notation', [tid, p.notation]] : ['DELETE FROM song_part_notation WHERE part_id = ?', [tid]]);
      ops.push(logRow(who, 'update', 'song_parts', tid, 'Übernommen nach ' + ver)); await s.batch(ops);
      return { id: tid, created: !twin };
    }
    case '/api/t/song/part/delete': await s.batch([['DELETE FROM song_parts WHERE id = ?', [String(body.id || '')]], ['DELETE FROM song_part_notation WHERE part_id = ?', [String(body.id || '')]], ['DELETE FROM song_part_version WHERE part_id = ?', [String(body.id || '')]]]); return { ok: true };
    case '/api/t/transcribe': return transcribeImage(env, body, cleanNotation, HttpError);
    case '/api/t/preview': return studentView(s, String(body.id || ''), 'student');
    case '/api/t/assignment/link': return linkAssignment(s, who, body);
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
    case '/api/t/assignments/new': {
      // Hausaufgabe in der Stunde sofort speichern, damit Oti sie gleich sortieren kann und der Schüler sie sieht
      const st = await s.first('SELECT id, first_name FROM students WHERE id = ?', String(body.student_id || ''));
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      const t = now(), stmts = [];
      const { newIds, skipped } = await newAssignmentStatements(s, st, null, body.items, new Set(), t, stmts);
      if (!newIds.length) return { ids: [], skipped };
      stmts.push(logRow(who, 'create', 'assignments', newIds[0], newIds.length + ' Hausaufgabe(n) in der Stunde'));
      await s.batch(stmts);
      const ord = await orderAppend(s, st.id, newIds); if (ord.length) await s.batch(ord);
      return { ids: newIds, skipped };
    }
    case '/api/t/lesson/live': {
      // Stunde läuft: Schüler App im Unterrichtsmodus. Endet mit "Stunde beenden" oder spätestens nach Stundenlänge plus 15 Minuten.
      const st = await s.first('SELECT id, lesson_minutes FROM students WHERE id = ?', String(body.student_id || ''));
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      const t = now(), cur = await s.first('SELECT id FROM lesson_windows WHERE student_id = ? AND started_at <= ? AND until > ? ORDER BY until DESC LIMIT 1', st.id, t, t);
      if (!body.on) { if (cur) await s.run('UPDATE lesson_windows SET until = ? WHERE id = ?', t, cur.id); return { until: null }; }
      const until = new Date(Date.now() + ((st.lesson_minutes || 45) + 15) * 60000).toISOString();
      if (cur) await s.run('UPDATE lesson_windows SET until = MAX(until, ?) WHERE id = ?', until, cur.id);
      else await s.run('INSERT INTO lesson_windows (id, student_id, started_at, until) VALUES (?, ?, ?, ?)', uid(), st.id, t, until);
      return { until };
    }
    case '/api/t/lessons/merge': {
      // Mehrere Stunden eines Schülers am selben Tag zu einer zusammenführen (Notizen, Hausaufgaben, Minuten)
      const keep = await s.first('SELECT * FROM lessons WHERE id = ?', String(body.keep_id || ''));
      if (!keep) throw new HttpError(404, 'Stunde nicht gefunden.');
      const others = await s.all('SELECT * FROM lessons WHERE student_id = ? AND date = ? AND id != ? ORDER BY created_at', keep.student_id, keep.date, keep.id);
      let nt = keep.notes_teacher, ns = keep.notes_shared, mn = keep.minutes;
      for (const o of others) { nt = mergeNotes(nt, o.notes_teacher); ns = mergeNotes(ns, o.notes_shared); mn = Math.max(mn || 0, o.minutes || 0) || null; }
      const ops = [['UPDATE lessons SET notes_teacher = ?, notes_shared = ?, minutes = ? WHERE id = ?', [nt, ns, mn, keep.id]]];
      for (const o of others) { ops.push(['UPDATE assignments SET lesson_id = ? WHERE lesson_id = ?', [keep.id, o.id]]); ops.push(['DELETE FROM lessons WHERE id = ?', [o.id]]); }
      ops.push(logRow(who, 'update', 'lessons', keep.id, `${others.length} Stunden zusammengeführt`));
      await s.batch(ops);
      return { merged: others.length, notes_teacher: nt };
    }
    case '/api/t/import/lessons': return importLessons(s, who, body);
    case '/api/t/assignment/status': {
      const status = body.status === 'erledigt' ? 'erledigt' : 'offen';
      await s.run('UPDATE assignments SET status = ?, done_at = ? WHERE id = ?', status, status === 'erledigt' ? now() : null, String(body.id || ''));
      return { ok: true };
    }
    case '/api/t/assignment/add': {
      // Hausaufgabe ohne Stunde aufgeben, z. B. einen Song Baustein mit Noten
      const st = await s.first('SELECT id FROM students WHERE id = ?', String(body.student_id || ''));
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      const part = body.part_id ? await s.first('SELECT p.id, p.song_id, p.title, p.notes, sg.title AS song_title, n.notation, COALESCE((SELECT bpm FROM song_meta WHERE song_id = sg.id), (SELECT MAX(bpm) FROM song_files WHERE song_id = sg.id)) AS song_bpm FROM song_parts p JOIN songs sg ON sg.id = p.song_id LEFT JOIN song_part_notation n ON n.part_id = p.id WHERE p.id = ?', String(body.part_id)) : null;
      // Bausteine: Standard Tempobereich 45 bis Original Tempo des Songs
      if (part && body.start_bpm == null && body.target_bpm == null) { body.start_bpm = 45; body.target_bpm = part.song_bpm || null; }
      if (body.part_id && !part) throw new HttpError(404, 'Baustein nicht gefunden.');
      const title = str(body.free_text, 300) || (part ? part.song_title + ': ' + part.title : null);
      if (!title) throw new HttpError(400, 'Aufgabe fehlt.');
      const nt = body.notation ? cleanNotation(body.notation) : null; // Baustein Noten werden verlinkt, nicht kopiert
      const open = await s.all("SELECT LOWER(TRIM(free_text)) AS ft FROM assignments WHERE student_id = ? AND status = 'offen'", st.id);
      if (open.some((r) => r.ft === title.trim().toLowerCase())) throw new HttpError(409, 'Du hast die Hausaufgabe schon aufgegeben.');
      const t = now(), aid = uid(); const ops = []; let exId = null;
      if (nt) { exId = uid(); ops.push(['INSERT INTO exercises (id, title, category, source_type, notes, target_bpm, notation, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [exId, title.slice(0, 120), 'Hausaufgaben', 'noten', part ? part.notes : null, int(body.target_bpm, 20, 400), nt, t]]); }
      if (part) ops.push(['INSERT INTO assignment_songs (assignment_id, song_id, version) VALUES (?, ?, ?)', [aid, part.song_id, str(body.version, 40)]], ['INSERT INTO assignment_parts (assignment_id, part_id) VALUES (?, ?)', [aid, part.id]]);
      ops.push(['INSERT INTO assignments (id, student_id, lesson_id, exercise_id, free_text, target_bpm, start_bpm, minutes_per_day, due_date, status, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
        [aid, st.id, exId, title, int(body.target_bpm, 20, 400), int(body.start_bpm, 20, 400), int(body.minutes_per_day, 1, 240) || 10, isDate(body.due_date) ? body.due_date : null, 'offen', t]]);
      ops.push(logRow(who, 'create', 'assignments', aid, title)); await s.batch(ops);
      const ord = await orderAppend(s, st.id, [aid]); if (ord.length) await s.batch(ord); return { id: aid };
    }
    case '/api/t/assignments/reorder': {
      // Reihenfolge der offenen Hausaufgaben eines Schülers festlegen
      const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 100).map(String);
      const own = new Set((await s.all('SELECT id FROM assignments WHERE student_id = ?', String(body.student_id || ''))).map((x) => x.id));
      if (!ids.length || ids.some((x) => !own.has(x))) throw new HttpError(400, 'Hausaufgaben passen nicht zum Schüler.');
      await s.batch(ids.map((x, i) => ['INSERT INTO assignment_order (assignment_id, sort) VALUES (?, ?) ON CONFLICT(assignment_id) DO UPDATE SET sort = excluded.sort', [x, i]]));
      return { ok: true };
    }
    case '/api/t/assignment/update': {
      // Hausaufgabe bearbeiten: Text, Tempo, Minuten; Noten nur bei eigener Hausaufgaben Übung (nicht Bibliothek)
      // Änderungen gehen an die Quelle: Song Baustein oder Übung. So sind sie überall gleich (alle Schüler, Bibliothek, Kurs, Song).
      const a = await s.first('SELECT a.id, a.exercise_id, e.archived, ap.part_id FROM assignments a LEFT JOIN exercises e ON e.id = a.exercise_id LEFT JOIN assignment_parts ap ON ap.assignment_id = a.id WHERE a.id = ?', String(body.id || ''));
      if (!a) throw new HttpError(404, 'Hausaufgabe nicht gefunden.');
      const ops = [['UPDATE assignments SET free_text = COALESCE(?, free_text), start_bpm = ?, target_bpm = ?, minutes_per_day = ? WHERE id = ?',
        [str(body.free_text, 300), int(body.start_bpm, 20, 400), int(body.target_bpm, 20, 400), int(body.minutes_per_day, 1, 240), a.id]]];
      const nt = body.notation ? cleanNotation(body.notation) : null, title = str(body.title, 120);
      if (a.part_id) {
        if (nt) ops.push(['INSERT INTO song_part_notation (part_id, notation) VALUES (?, ?) ON CONFLICT(part_id) DO UPDATE SET notation = excluded.notation', [a.part_id, nt]]);
        if (title) ops.push(['UPDATE song_parts SET title = ? WHERE id = ?', [title, a.part_id]]);
      } else if (a.exercise_id) {
        if (title && !a.archived) await assertFreeTitle(s, title, a.exercise_id);
        if (nt) ops.push(['UPDATE exercises SET notation = ? WHERE id = ?', [nt, a.exercise_id]]);
        const t2 = title || (a.archived ? str(body.free_text, 120) : null);
        if (t2) ops.push(['UPDATE exercises SET title = ? WHERE id = ?', [t2, a.exercise_id]]);
      }
      ops.push(logRow(who, 'update', 'assignments', a.id, 'Hausaufgabe bearbeitet'));
      await s.batch(ops);
      return { ok: true };
    }
    case '/api/t/assignment/delete': {
      const a = await s.first('SELECT id, free_text FROM assignments WHERE id = ?', String(body.id || ''));
      if (!a) throw new HttpError(404, 'Hausaufgabe nicht gefunden.');
      await s.batch([
        ['DELETE FROM assignment_checks WHERE assignment_id = ?', [a.id]],
        ['DELETE FROM assignment_order WHERE assignment_id = ?', [a.id]],
        ['DELETE FROM assignment_songs WHERE assignment_id = ?', [a.id]],
        ['DELETE FROM assignments WHERE id = ?', [a.id]],
        logRow(who, 'delete', 'assignments', a.id, 'Hausaufgabe entfernt' + (a.free_text ? ': ' + a.free_text.slice(0, 60) : '')),
      ]);
      return { ok: true };
    }
    case '/api/t/feed': return { feed: await s.all('SELECT at, by_role, action, entity, summary FROM log ORDER BY at DESC LIMIT 60') };
  }
  throw new HttpError(404, 'Unbekannte Aktion.');
}

// Schema einmal pro Instanz anlegen (CREATE ... IF NOT EXISTS)
const schemaReady = new WeakMap();
export function ensureSchema(env) {
  let p = schemaReady.get(env.DB);
  if (!p) {
    const stmts = (SCHEMA + SONG_SCHEMA + COURSE_SCHEMA).replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean);
    p = env.DB.batch(stmts.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady.delete(env.DB); throw e; });
    schemaReady.set(env.DB, p);
  }
  return p;
}

export function manifestFor(c) {
  const code = /^[A-Za-z0-9-]{8,64}$/.test(String(c || '')) ? String(c) : null;
  const m = { name: 'Practice Hub', short_name: 'Practice Hub', lang: 'de', start_url: code ? '/#c=' + code : '/', scope: '/', display: 'standalone', background_color: '#e5e5e0', theme_color: '#e5e5e0',
    icons: [{ src: '/icon-180.png', sizes: '180x180', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] };
  return new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export default {
  async fetch(req, env) {
    const url0 = new URL(req.url);
    // Alles außer /api liefert die App aus (Cloudflare Assets)
    if (!url0.pathname.startsWith('/api/') && env.ASSETS) return env.ASSETS.fetch(req);
    // Manifest mit persönlichem Start Link: die Home Bildschirm App am iPhone hat einen eigenen Speicher und braucht den Code beim ersten Start
    if (url0.pathname === '/api/manifest') return manifestFor(url0.searchParams.get('c'));
    await ensureSchema(env);
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      let body = {};
      if (req.method === 'POST') {
        const text = await req.text();
        if (text.length > (url.pathname === '/api/t/transcribe' ? 3000000 : 100000)) throw new HttpError(413, 'Anfrage zu groß.');
        body = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Ungültige Anfrage.');
      }
      return json(await route(env, req, url.pathname, body), 200, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'Serverfehler. Bitte später nochmal.' + (url.pathname === '/api/t/transcribe' ? ' (' + String(e && e.message || e).slice(0, 200) + ')' : '') : e.message }, status, cors);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(() => cleanup(env)).then(() => syncSongs(env).catch((e) => console.log('Song Abgleich:', e.message))));
  },
};
