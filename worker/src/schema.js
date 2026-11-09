// Datenbankschema, wird beim ersten Aufruf automatisch angelegt (idempotent)
export const SCHEMA = `-- Practice Hub D1 Schema v1 (04.11.2026)
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  birth_year INTEGER,
  is_minor INTEGER NOT NULL DEFAULT 1,
  weekday INTEGER,            -- 1 = Montag ... 7 = Sonntag
  lesson_time TEXT,           -- "16:00"
  lesson_minutes INTEGER DEFAULT 45,
  level TEXT,
  instrument TEXT DEFAULT 'Schlagzeug',
  profile_note TEXT,          -- Steckbrief, nur Lehrer
  status TEXT NOT NULL DEFAULT 'aktiv', -- aktiv, pausiert, archiviert
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS access (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL,         -- student, parent
  label TEXT,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  access_id TEXT NOT NULL,    -- 'teacher' für Oti
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  access_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version_text TEXT NOT NULL,
  given_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  source_type TEXT,           -- youtube, instagram, drive, buch, link
  url TEXT,
  book_ref TEXT,
  target_bpm INTEGER,
  notes TEXT,
  notation TEXT,              -- JSON eines Beats aus dem Noten Editor
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  minutes INTEGER,
  notes_teacher TEXT,
  notes_shared TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  lesson_id TEXT,
  exercise_id TEXT,
  free_text TEXT,
  target_bpm INTEGER,
  start_bpm INTEGER,
  minutes_per_day INTEGER,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'offen',
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen',
  reached_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL,
  assignment_id TEXT,
  exercise_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  local_date TEXT NOT NULL,   -- YYYY-MM-DD in Ortszeit des Geräts
  seconds INTEGER NOT NULL,
  bpm_reached INTEGER,
  feeling INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS log (
  at TEXT NOT NULL,
  by_role TEXT NOT NULL,
  by_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS i_access_student ON access(student_id);
CREATE INDEX IF NOT EXISTS i_devices_access ON devices(access_id);
CREATE INDEX IF NOT EXISTS i_lessons_student ON lessons(student_id, date);
CREATE INDEX IF NOT EXISTS i_assign_student ON assignments(student_id, status);
CREATE INDEX IF NOT EXISTS i_sessions_student ON practice_sessions(student_id, started_at);
CREATE INDEX IF NOT EXISTS i_goals_student ON goals(student_id);
CREATE INDEX IF NOT EXISTS i_attempts ON attempts(ip, at);

-- Schüler Haken getrennt vom Lehrer Status (nur Oti schließt eine Hausaufgabe)
-- Reihenfolge der Hausaufgaben, vom Lehrer per Ziehen festgelegt (neue ohne Eintrag stehen oben)
CREATE TABLE IF NOT EXISTS assignment_order (
  assignment_id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assignment_checks (
  assignment_id TEXT PRIMARY KEY,
  student_done_at TEXT NOT NULL
);

-- Abgesagte Stunden (schueler, kurzfristig, lehrer)
CREATE TABLE IF NOT EXISTS cancellations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (student_id, date)
);
`;
