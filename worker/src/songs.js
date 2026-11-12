// Songs aus dem Lobpreis Ordner (Google Drive, öffentlich lesbar), Setlists, Bausteine, Meine Setlist
export const SONG_SCHEMA = `
CREATE TABLE IF NOT EXISTS song_teaching (
  song_id TEXT PRIMARY KEY,   -- Unterrichtssongs: state 'on' = im Reiter Unterricht, 'hidden' = kein Vorschlag mehr
  state TEXT,
  kind TEXT,                  -- 'worship' oder 'andere'; ohne Eintrag: Drive Songs worship, sonst andere
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,        -- Sprache:normalisierter Titel
  title TEXT NOT NULL,
  lang TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_files (
  drive_id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_sig TEXT,
  bpm INTEGER,
  kind TEXT,
  seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_part_notation (
  part_id TEXT PRIMARY KEY,
  notation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_parts (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS setlists (
  date TEXT PRIMARY KEY,
  items TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS student_songs (
  student_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (student_id, song_id)
);
CREATE TABLE IF NOT EXISTS worship_students (student_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS song_links (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  version TEXT NOT NULL,       -- z. B. Original, Easy
  title TEXT,
  url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
UPDATE song_links SET version = 'Oti Playthrough' WHERE version = 'Playthrough';
CREATE TABLE IF NOT EXISTS assignment_songs (
  assignment_id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  version TEXT
);
CREATE INDEX IF NOT EXISTS i_song_links ON song_links(song_id, sort);
CREATE INDEX IF NOT EXISTS i_assignment_songs ON assignment_songs(song_id);
CREATE INDEX IF NOT EXISTS i_song_files ON song_files(song_id);
CREATE INDEX IF NOT EXISTS i_song_parts ON song_parts(song_id, sort);
-- Gelöschte Songs: Drive Songs kommen beim Abgleich wieder, darum ausblenden statt löschen (umkehrbar)
CREATE TABLE IF NOT EXISTS song_hidden (
  song_id TEXT PRIMARY KEY,
  hidden_at TEXT NOT NULL
);
-- Gitarre pro Song: Akkorde, Capo, Schlagmuster (Gitarren Notation) und Akkordblatt als Text
CREATE TABLE IF NOT EXISTS song_guitar (
  song_id TEXT PRIMARY KEY,
  notation TEXT,
  sheet TEXT,
  key_sig TEXT,
  updated_at TEXT NOT NULL
);
-- Original BPM pro Song (aus dem Internet oder von Oti), hat Vorrang vor BPM aus Dateinamen
CREATE TABLE IF NOT EXISTS song_meta (
  song_id TEXT PRIMARY KEY,
  bpm INTEGER,
  bpm_source TEXT
);
-- Baustein gehört zu einer Version (Original, Easy, ...). Ohne Eintrag gilt er für alle Versionen.
CREATE TABLE IF NOT EXISTS song_part_version (
  part_id TEXT PRIMARY KEY,
  version TEXT NOT NULL
);
INSERT OR IGNORE INTO song_part_version (part_id, version) SELECT id, 'Easy' FROM song_parts WHERE title LIKE '%(Easy)';
UPDATE song_part_version SET version = 'Oti Playthrough' WHERE version = 'Playthrough';
INSERT OR IGNORE INTO song_part_version (part_id, version) SELECT id, 'Original' FROM song_parts WHERE title LIKE '%(Original)';
CREATE TABLE IF NOT EXISTS assignment_parts (
  assignment_id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL
);
INSERT OR IGNORE INTO assignment_parts (assignment_id, part_id)
  SELECT a.id, p.id FROM assignments a JOIN exercises e ON e.id = a.exercise_id AND e.archived = 1 JOIN assignment_songs x ON x.assignment_id = a.id
  JOIN song_parts p ON p.song_id = x.song_id JOIN songs sg ON sg.id = p.song_id WHERE e.title = sg.title || ': ' || p.title;
-- Song Hausaufgaben haben keinen Tempobereich, nur das Original Tempo des Songs
UPDATE assignments SET start_bpm = NULL WHERE start_bpm IS NOT NULL AND id IN (SELECT assignment_id FROM assignment_songs) AND id NOT IN (SELECT assignment_id FROM assignment_parts);
`;

export const LIEDER_ROOT = '1eRaPJfiT2-xeDRKzzUuX-R4ypyQOr7_r';
const LIB_FOLDERS = { Deutsch: 'de', English: 'en' };

// Einträge einer öffentlich geteilten Drive Ordneransicht
export function parseFolder(html) {
  const out = [];
  const re = /id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], folder: /\/folders\//.test(m[2]), name: decode(m[3]).trim() });
  return out;
}
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

const KEY = /^[A-H](#|b)?m?$/;
// "1. Der Sieg gehört dir allein - A - 81.pdf" → Titel, Tonart, Tempo
export function parseSongName(name) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '';
  let base = name.replace(/\.[a-z0-9]+$/i, '').replace(/^\s*\d+\s*[.)]\s*/, '');
  let title = base, rest = '';
  if (!/\s/.test(base) && base.includes('-')) {
    // "Du-allein-rettest-mich-E": Bindestriche statt Leerzeichen, Tonart und Zahlen hinten abschneiden
    const tk = base.split('-'); const tail = [];
    while (tk.length > 1 && (KEY.test(tk[tk.length - 1]) || /^\d+$/.test(tk[tk.length - 1]) || /^chords$/i.test(tk[tk.length - 1]))) tail.unshift(tk.pop());
    title = tk.join(' '); title = title.charAt(0).toUpperCase() + title.slice(1); rest = tail.join(' ');
  } else {
    const m = /^(.*?)\s*-\s*(.+)$/.exec(base);
    if (m) { title = m[1]; rest = m[2]; }
  }
  let key = null, bpm = null;
  for (const t of rest.split(/[\s-]+/)) {
    if (!key && KEY.test(t)) key = t;
    else if (!bpm && /^\d{2,3}$/.test(t) && +t >= 40 && +t <= 220) bpm = +t;
  }
  return { title: title.trim(), key, bpm, kind: ext.toLowerCase() };
}
export function slug(title) { return title.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

async function folder(fetcher, id) {
  const r = await fetcher('https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(id));
  if (!r.ok) throw new Error('Drive Ordner nicht lesbar (' + r.status + ')');
  return parseFolder(await r.text());
}

export async function syncSongs(env, fetcher = fetch) {
  const db = env.DB, t = new Date().toISOString();
  const top = await folder(fetcher, LIEDER_ROOT);
  const stmts = [];
  let files = 0;
  for (const [name, lang] of Object.entries(LIB_FOLDERS)) {
    const f = top.find((x) => x.folder && x.name === name);
    if (!f) continue;
    for (const e of await folder(fetcher, f.id)) {
      if (e.folder || !/^(pdf|docx?)$/i.test((/\.([a-z]+)$/i.exec(e.name) || [])[1] || '')) continue;
      const p = parseSongName(e.name); if (!p.title) continue;
      const sid = lang + ':' + slug(p.title);
      stmts.push(['INSERT INTO songs (id, title, lang, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at', [sid, p.title, lang, t]]);
      stmts.push(['INSERT INTO song_files (drive_id, song_id, name, key_sig, bpm, kind, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(drive_id) DO UPDATE SET song_id = excluded.song_id, name = excluded.name, key_sig = excluded.key_sig, bpm = excluded.bpm, kind = excluded.kind, seen_at = excluded.seen_at',
        [e.id, sid, e.name, p.key, p.bpm, p.kind, t]]);
      files++;
    }
  }
  // Setlists: Unterordner "Sonntag, 08.11.2026"
  const setsF = top.find((x) => x.folder && /lieder sets/i.test(x.name));
  let sundays = 0;
  if (setsF) {
    for (const sf of await folder(fetcher, setsF.id)) {
      const d = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(sf.name); if (!sf.folder || !d) continue;
      const date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      const items = (await folder(fetcher, sf.id)).filter((e) => !e.folder).map((e) => {
        const p = parseSongName(e.name); const n = +((/^\s*(\d+)/.exec(e.name) || [])[1] || 0);
        return { n, title: p.title, key: p.key, bpm: p.bpm, drive_id: e.id, slug: slug(p.title) };
      }).sort((a, b) => a.n - b.n || a.title.localeCompare(b.title));
      stmts.push(['INSERT INTO setlists (date, items, synced_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET items = excluded.items, synced_at = excluded.synced_at', [date, JSON.stringify(items), t]]);
      sundays++;
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90).map(([q, a]) => db.prepare(q).bind(...a)));
  // Dateien, die nicht mehr im Ordner sind, fallen raus (nur wenn der Abgleich etwas gefunden hat)
  if (files > 0) await db.prepare('DELETE FROM song_files WHERE seen_at < ?').bind(t).run();
  await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('songs_synced', JSON.stringify({ at: t, files, sundays })).run();
  return { files, sundays, at: t };
}

const today = () => new Date().toISOString().slice(0, 10);

async function sundaySetlist(s) {
  const row = await s.first('SELECT date, items FROM setlists WHERE date >= ? ORDER BY date LIMIT 1', today());
  if (!row) return null;
  const items = JSON.parse(row.items);
  const songs = await s.all('SELECT id, title FROM songs WHERE id NOT IN (SELECT song_id FROM song_hidden)');
  const bySlug = {}; for (const x of songs) bySlug[slug(x.title)] = bySlug[slug(x.title)] || x.id;
  // Umbenannte Songs: der ursprüngliche Titel steckt in der ID (Sprache:Titel), damit Setlists weiter passen
  for (const x of songs) { const k = x.id.split(':').slice(1).join(':'); if (k && !bySlug[k]) bySlug[k] = x.id; }
  for (const it of items) it.song_id = bySlug[it.slug] || null;
  return { date: row.date, items };
}

// Für Schüler und Lehrer: Bibliothek, Meine Setlist, Sonntagsliste (nur Lobpreis Schüler)
export async function songsHome(s, who) {
  const studentId = who.role === 'teacher' ? null : who.studentId;
  const [lib, parts, mine, worship, meta] = await Promise.all([
    s.all(`SELECT s.id, s.title, s.lang, GROUP_CONCAT(DISTINCT f.key_sig) AS keys, COALESCE(MAX(m.bpm), MAX(f.bpm)) AS bpm,
             (SELECT state FROM song_teaching WHERE song_id = s.id) AS t_state, (SELECT kind FROM song_teaching WHERE song_id = s.id) AS t_kind,
             EXISTS (SELECT 1 FROM assignment_songs x WHERE x.song_id = s.id) AS assigned
           FROM songs s LEFT JOIN song_files f ON f.song_id = s.id LEFT JOIN song_meta m ON m.song_id = s.id WHERE s.id NOT IN (SELECT song_id FROM song_hidden) GROUP BY s.id
           HAVING COUNT(f.drive_id) > 0 OR s.lang = 'unterricht' OR EXISTS (SELECT 1 FROM song_teaching t WHERE t.song_id = s.id AND t.state = 'on') OR EXISTS (SELECT 1 FROM song_parts p WHERE p.song_id = s.id) OR EXISTS (SELECT 1 FROM song_links k WHERE k.song_id = s.id) ORDER BY s.title COLLATE NOCASE`),
    s.all('SELECT song_id, COUNT(*) AS n FROM (SELECT song_id FROM song_parts UNION ALL SELECT song_id FROM song_links) GROUP BY song_id'),
    studentId ? s.all('SELECT song_id FROM student_songs WHERE student_id = ? ORDER BY added_at', studentId) : [],
    studentId ? s.first('SELECT 1 AS w FROM worship_students WHERE student_id = ?', studentId) : { w: 1 },
    s.first("SELECT v FROM meta WHERE k = 'songs_synced'"),
  ]);
  const pn = {}; for (const p of parts) pn[p.song_id] = p.n;
  const songs = lib.map((x) => ({ id: x.id, title: x.title, lang: x.lang, keys: (x.keys || '').split(',').filter(Boolean), bpm: x.bpm, parts: pn[x.id] || 0,
    teach: x.t_state === 'on' || x.lang === 'unterricht' || !!x.assigned, pinned: x.t_state === 'on', kind: songKind(x) }));
  return { songs, mine: mine.map((m) => m.song_id), sunday: worship ? await sundaySetlist(s) : null, worship: !!worship, synced: meta ? JSON.parse(meta.v) : null };
}

export async function songDetail(s, id, teacher = false) {
  const song = await s.first(`SELECT s.id, s.title, s.lang, COALESCE(m.bpm, (SELECT MAX(bpm) FROM song_files WHERE song_id = s.id)) AS bpm, m.bpm_source
    FROM songs s LEFT JOIN song_meta m ON m.song_id = s.id WHERE s.id = ?`, String(id || ''));
  if (!song) return null;
  const [files, parts, links, playedBy, guitar] = await Promise.all([
    s.all('SELECT drive_id, name, key_sig, bpm, kind FROM song_files WHERE song_id = ? ORDER BY kind DESC, name', song.id),
    s.all('SELECT p.id, p.title, p.url, p.notes, p.sort, n.notation, v.version FROM song_parts p LEFT JOIN song_part_notation n ON n.part_id = p.id LEFT JOIN song_part_version v ON v.part_id = p.id WHERE p.song_id = ? ORDER BY p.sort, p.created_at', song.id),
    s.all('SELECT id, version, title, url, sort FROM song_links WHERE song_id = ? ORDER BY sort, created_at', song.id),
    teacher ? s.all(`SELECT DISTINCT st.first_name FROM students st WHERE st.id IN (
        SELECT a.student_id FROM assignment_songs x JOIN assignments a ON a.id = x.assignment_id WHERE x.song_id = ?
        UNION SELECT student_id FROM student_songs WHERE song_id = ?) ORDER BY st.first_name`, song.id, song.id) : [],
    s.first('SELECT notation, sheet, key_sig FROM song_guitar WHERE song_id = ?', song.id),
  ]);
  return { song, files, parts, links, playedBy: playedBy.map((r) => r.first_name), guitar: guitar || null };
}

// Links in einer Zeile pro Link: "Easy | https://…" oder "Original https://…"; ohne Version gilt die gewählte
export function parseLinkLines(text, fallback = 'Original') {
  const out = [];
  for (const raw of String(text || '').split(/\n+/).slice(0, 30)) {
    const line = raw.trim(); if (!line) continue;
    const m = /(https?:\/\/\S+|(?:www\.)?(?:youtu\.be|youtube\.com|instagram\.com|drive\.google\.com)\/\S+)/i.exec(line);
    if (!m) continue;
    const before = line.slice(0, m.index).replace(/[|:\-–]+\s*$/, '').trim();
    out.push({ version: (before || fallback).slice(0, 40), url: m[1] });
  }
  return out;
}

export const songKind = (x) => x.t_kind || (x.lang === 'de' || x.lang === 'en' ? 'worship' : 'andere');

// Unterrichtssongs: Vorschläge aus Stundennotizen und Hausaufgaben. Zählt nur Zeilen, die mit dem Songtitel beginnen,
// und überspringt Setlisten (Opfer:, Schluss:, Liste …), damit Sonntagslisten nicht als Unterricht zählen.
const normT = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const SETLIST = /^(opfer|schluss|reserve|liste|set ?list|set|sonntag|samstag|montag|vorbereitung)\b/;
export async function songSuggestions(s) {
  const songs = await s.all(`SELECT s.id, s.title, s.lang, t.state, EXISTS (SELECT 1 FROM assignment_songs x WHERE x.song_id = s.id) AS assigned FROM songs s LEFT JOIN song_teaching t ON t.song_id = s.id WHERE s.id NOT IN (SELECT song_id FROM song_hidden)`);
  const cand = songs.filter((x) => !(x.state === 'on' || x.state === 'hidden' || x.lang === 'unterricht' || x.assigned))
    .map((x) => ({ id: x.id, title: x.title, k: normT(x.title.replace(/\s*\(.*?\)\s*/g, ' ')) })).filter((x) => x.k.length >= 4)
    .sort((a, b) => b.k.length - a.k.length);
  const rows = (await s.all('SELECT student_id, date, notes_teacher, notes_shared FROM lessons')).map((r) => [r.student_id, r.date, (r.notes_teacher || '') + '\n' + (r.notes_shared || '')])
    .concat((await s.all('SELECT student_id, created_at, free_text FROM assignments WHERE free_text IS NOT NULL')).map((r) => [r.student_id, String(r.created_at).slice(0, 10), r.free_text]));
  const hits = {};
  for (const [sid, date, text] of rows) {
    for (const raw of String(text).split(/\n|;|•/)) {
      const n = normT(raw); if (!n || SETLIST.test(n)) continue;
      const m = cand.find((c) => n === c.k || n.startsWith(c.k + ' ')); if (!m) continue;
      const h = hits[m.id] || (hits[m.id] = { id: m.id, title: m.title, keys: new Set(), students: new Set(), line: raw.trim().replace(/https?:\S*/g, '').slice(0, 90) });
      h.keys.add(sid + '|' + date); h.students.add(sid);
    }
  }
  return Object.values(hits).map((h) => ({ id: h.id, title: h.title, lessons: h.keys.size, students: h.students.size, line: h.line }))
    .sort((a, b) => b.lessons - a.lessons || b.students - a.students).slice(0, 120);
}
