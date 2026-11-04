// Songs aus dem Lobpreis Ordner (Google Drive, öffentlich lesbar), Setlists, Bausteine, Meine Setlist
export const SONG_SCHEMA = `
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
CREATE INDEX IF NOT EXISTS i_song_files ON song_files(song_id);
CREATE INDEX IF NOT EXISTS i_song_parts ON song_parts(song_id, sort);
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
  const m = /^(.*?)\s*-\s*(.+)$/.exec(base);
  let title = base, rest = '';
  if (m) { title = m[1]; rest = m[2]; }
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
  const songs = await s.all('SELECT id, title FROM songs');
  const bySlug = {}; for (const x of songs) bySlug[slug(x.title)] = bySlug[slug(x.title)] || x.id;
  for (const it of items) it.song_id = bySlug[it.slug] || null;
  return { date: row.date, items };
}

// Für Schüler und Lehrer: Bibliothek, Meine Setlist, Sonntagsliste (nur Lobpreis Schüler)
export async function songsHome(s, who) {
  const studentId = who.role === 'teacher' ? null : who.studentId;
  const [lib, parts, mine, worship, meta] = await Promise.all([
    s.all(`SELECT s.id, s.title, s.lang, GROUP_CONCAT(DISTINCT f.key_sig) AS keys, MAX(f.bpm) AS bpm
           FROM songs s LEFT JOIN song_files f ON f.song_id = s.id GROUP BY s.id
           HAVING COUNT(f.drive_id) > 0 OR EXISTS (SELECT 1 FROM song_parts p WHERE p.song_id = s.id) ORDER BY s.title COLLATE NOCASE`),
    s.all('SELECT song_id, COUNT(*) AS n FROM song_parts GROUP BY song_id'),
    studentId ? s.all('SELECT song_id FROM student_songs WHERE student_id = ? ORDER BY added_at', studentId) : [],
    studentId ? s.first('SELECT 1 AS w FROM worship_students WHERE student_id = ?', studentId) : { w: 1 },
    s.first("SELECT v FROM meta WHERE k = 'songs_synced'"),
  ]);
  const pn = {}; for (const p of parts) pn[p.song_id] = p.n;
  const songs = lib.map((x) => ({ id: x.id, title: x.title, lang: x.lang, keys: (x.keys || '').split(',').filter(Boolean), bpm: x.bpm, parts: pn[x.id] || 0 }));
  return { songs, mine: mine.map((m) => m.song_id), sunday: worship ? await sundaySetlist(s) : null, worship: !!worship, synced: meta ? JSON.parse(meta.v) : null };
}

export async function songDetail(s, id) {
  const song = await s.first('SELECT id, title, lang FROM songs WHERE id = ?', String(id || ''));
  if (!song) return null;
  const [files, parts] = await Promise.all([
    s.all('SELECT drive_id, name, key_sig, bpm, kind FROM song_files WHERE song_id = ? ORDER BY kind DESC, name', song.id),
    s.all('SELECT id, title, url, notes, sort FROM song_parts WHERE song_id = ? ORDER BY sort, created_at', song.id),
  ]);
  return { song, files, parts };
}
