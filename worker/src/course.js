// Kurs: Level, Lektionen, Inhalte (Video, Song, Text) und Fortschritt pro Schüler
import { slug } from './songs.js';

export const COURSE_SCHEMA = `
CREATE TABLE IF NOT EXISTS lesson_windows (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_windows_student ON lesson_windows (student_id, until);
CREATE TABLE IF NOT EXISTS course_levels (
  course TEXT NOT NULL,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (course, level)
);
CREATE TABLE IF NOT EXISTS course_lessons (
  id TEXT PRIMARY KEY,
  course TEXT NOT NULL,
  level INTEGER NOT NULL,
  num INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_items (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- video, song, text, material (nur Lehrer), exercise (url = Übungs ID aus der Bibliothek)
  title TEXT NOT NULL,
  url TEXT,
  song_title TEXT,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS student_lessons (
  student_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- offen, fertig
  assigned_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (student_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS i_course_lessons ON course_lessons(course, num);
CREATE INDEX IF NOT EXISTS i_lesson_items ON lesson_items(lesson_id, sort);
`;

const KINDS = ['video', 'song', 'text', 'material', 'exercise'];
const s200 = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

export async function courseData(s, course, studentId, teacher = false) {
  const [levels, lessons, items, songs, mine] = await Promise.all([
    s.all('SELECT level, name FROM course_levels WHERE course = ? ORDER BY level', course),
    s.all('SELECT id, level, num, title, body FROM course_lessons WHERE course = ? ORDER BY num', course),
    s.all('SELECT i.id, i.lesson_id, i.kind, i.title, i.url, i.song_title, i.notes, i.sort FROM lesson_items i JOIN course_lessons l ON l.id = i.lesson_id WHERE l.course = ? ORDER BY i.sort, i.id', course),
    s.all('SELECT id, title FROM songs'),
    studentId ? s.all('SELECT lesson_id, status, assigned_at, done_at FROM student_lessons WHERE student_id = ?', studentId) : [],
  ]);
  const bySlug = {}; for (const x of songs) bySlug[slug(x.title)] = bySlug[slug(x.title)] || x.id;
  const exIds = [...new Set(items.filter((i) => i.kind === 'exercise' && i.url).map((i) => i.url))];
  const exById = {};
  for (let k = 0; k < exIds.length; k += 50) {
    const part = exIds.slice(k, k + 50);
    for (const e of await s.all(`SELECT id, title, notation, target_bpm, notes, url, source_type FROM exercises WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) exById[e.id] = e;
  }
  const byLesson = {};
  for (const it of items) { if (it.kind === 'material' && !teacher) continue; if (it.kind === 'exercise') { it.exercise = exById[it.url] || null; if (!it.exercise) continue; } if (it.kind === 'song') it.song_id = bySlug[slug(it.song_title || it.title)] || null; (byLesson[it.lesson_id] = byLesson[it.lesson_id] || []).push(it); }
  for (const l of lessons) l.items = byLesson[l.id] || [];
  const progress = {}; for (const m of mine) progress[m.lesson_id] = m;
  return { course, levels, lessons, progress, level: studentId ? currentLevel(levels, lessons, progress) : null };
}

// Aktuelles Level: das niedrigste mit einer noch nicht fertigen Lektion
export function currentLevel(levels, lessons, progress) {
  for (const lv of levels) {
    const ls = lessons.filter((l) => l.level === lv.level);
    if (!ls.length) continue; // leere Level überspringen
    const done = ls.filter((l) => progress[l.id] && progress[l.id].status === 'fertig').length;
    if (done < ls.length) return { level: lv.level, name: lv.name, done, total: ls.length };
  }
  const last = levels[levels.length - 1];
  return last ? { level: last.level, name: last.name, done: 1, total: 1, complete: true } : null;
}

export async function courseImport(s, b, now, uid) {
  const course = s200(b.course, 40) || 'drums';
  const have = await s.first('SELECT COUNT(*) AS n FROM course_lessons WHERE course = ?', course);
  if (have.n && !b.replace) throw Object.assign(new Error('Der Kurs hat schon Lektionen.'), { status: 409 });
  const stmts = [];
  if (b.replace) {
    stmts.push(['DELETE FROM lesson_items WHERE lesson_id IN (SELECT id FROM course_lessons WHERE course = ?)', [course]]);
    stmts.push(['DELETE FROM course_lessons WHERE course = ?', [course]]);
    stmts.push(['DELETE FROM course_levels WHERE course = ?', [course]]);
  }
  for (const lv of (b.levels || []).slice(0, 20)) stmts.push(['INSERT INTO course_levels (course, level, name) VALUES (?, ?, ?)', [course, +lv.level, s200(lv.name, 60)]]);
  let n = 0;
  for (const l of (b.lessons || []).slice(0, 100)) {
    const id = uid();
    stmts.push(['INSERT INTO course_lessons (id, course, level, num, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, course, +l.level, +l.num, s200(l.title, 120), s200(l.body, 2000), now()]]);
    (l.items || []).slice(0, 30).forEach((it, i) => {
      if (!KINDS.includes(it.kind)) return;
      stmts.push(['INSERT INTO lesson_items (id, lesson_id, kind, title, url, song_title, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [uid(), id, it.kind, s200(it.title, 160), s200(it.url, 500), s200(it.song_title, 160), s200(it.notes, 500), i]]);
    });
    n++;
  }
  for (let i = 0; i < stmts.length; i += 90) await s.batch(stmts.slice(i, i + 90));
  return { lessons: n };
}
