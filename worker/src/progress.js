// Fortschritt (23.11.2026): Einstellungen pro Schüler für Wochen Serie und Übe Erinnerungen
export const PROGRESS_SCHEMA = `
-- Zieltage pro Woche für die Serie (Standard 3), von Oti in der Akte gesetzt
CREATE TABLE IF NOT EXISTS student_streak (
  student_id TEXT PRIMARY KEY,
  days INTEGER NOT NULL
);
`;
export async function streakDays(s, studentId) {
  const r = await s.first('SELECT days FROM student_streak WHERE student_id = ?', studentId);
  return r ? r.days : 3;
}

// ---------- Übe Erinnerungen an Schüler (Otis Entscheidung 23.11.2026) ----------
// Nur an Tagen, die der Schüler wählt, zur gewählten Stunde, wenn heute noch nicht geübt; höchstens 1 pro Tag;
// Sonntag und BW Schulferien still; Serien Warnung statt normaler Erinnerung, wenn das Wochenziel kippt.
// Unter 16 nur mit Einwilligung der Eltern (consents). Abschalten jederzeit in der App.
export const PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS student_push_subs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_ok TEXT,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_student_push_subs ON student_push_subs (student_id);
-- days: JSON Liste 1 bis 6 (Mo bis Sa), hour: 14 bis 20
CREATE TABLE IF NOT EXISTS student_push_prefs (
  student_id TEXT PRIMARY KEY,
  days TEXT NOT NULL,
  hour INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_push_log (
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (student_id, date)
);
`;
export const DEFAULT_PREFS = { days: [1, 2, 3, 4, 5], hour: 17 };

// Gleiche Ferien und Serien Regeln wie public/progress.js (Test prüft Gleichheit)
export const HOLIDAYS_BW = [
  ['2025-12-22', '2026-01-05'], ['2026-03-30', '2026-04-11'], ['2026-05-26', '2026-06-05'], ['2026-07-30', '2026-09-12'],
  ['2026-10-26', '2026-10-31'], ['2026-12-23', '2027-01-09'], ['2027-03-25', '2027-03-25'], ['2027-03-30', '2027-04-03'],
  ['2027-05-18', '2027-05-29'], ['2027-07-29', '2027-09-11'], ['2027-11-02', '2027-11-06'], ['2027-12-23', '2028-01-08'],
];
const pad = (n) => String(n).padStart(2, '0');
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (s) => { const d = new Date(s + 'T12:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
export const isHoliday = (s) => HOLIDAYS_BW.some(([a, b]) => s >= a && s <= b);
const holidayWeek = (mon) => [0, 1, 2, 3, 4].filter((i) => isHoliday(addDays(mon, i))).length >= 3;
export function weekStreak(dates, target, today) {
  const t = Math.max(1, Math.min(7, target || 3)), played = new Set(dates), now = mondayOf(today);
  const count = (mon) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i)).filter((d) => played.has(d) && d <= today).length;
  const n = count(now); let weeks = n >= t ? 1 : 0;
  for (let i = 1; i < 260; i++) { const mon = addDays(now, -7 * i); if (count(mon) >= t) weeks++; else if (!holidayWeek(mon)) break; }
  return { weeks, n, target: t, left: Math.max(0, t - n), done: n >= t, holiday: holidayWeek(now) };
}
// Uhrzeit in Deutschland
export function berlinNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: wd };
}
export function cleanPrefs(b) {
  const days = [...new Set((Array.isArray(b && b.days) ? b.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 6))].sort();
  const h = Math.round(Number(b && b.hour));
  return { days, hour: h >= 14 && h <= 20 ? h : 17 };
}
// Text der Erinnerung oder null (pure Funktion, für Tests)
export function reminderText({ name, prefs, now, dates, target, sentToday }) {
  if (sentToday || now.weekday === 7 || isHoliday(now.date)) return null;
  if (!prefs.days.includes(now.weekday) || prefs.hour !== now.hour) return null;
  if (dates.includes(now.date)) return null;
  const r = weekStreak(dates, target, now.date);
  const daysLeft = 7 - now.weekday; // heute bis Samstag, Sonntag zählt mit
  if (!r.done && r.weeks >= 1 && r.left >= daysLeft) {
    return { kind: 'serie', title: 'Deine Serie: ' + r.weeks + (r.weeks === 1 ? ' Woche' : ' Wochen'), body: `Noch ${r.left} ${r.left === 1 ? 'Tag' : 'Tage'} diese Woche. Wenn du heute übst, bleibt deine Serie.` };
  }
  return { kind: 'ueben', title: 'Practice Hub', body: `Hey ${name}, heute noch nicht geübt. 10 Minuten reichen schon.` };
}
export async function studentReminders(s, sendFn, date = new Date()) {
  const now = berlinNow(date);
  if (now.weekday === 7 || isHoliday(now.date)) return { checked: 0, sent: 0 };
  const rows = await s.all(`SELECT p.student_id, p.days, p.hour, st.first_name FROM student_push_prefs p JOIN students st ON st.id = p.student_id
    WHERE st.status != 'archiviert' AND p.hour = ? AND EXISTS (SELECT 1 FROM student_push_subs x WHERE x.student_id = p.student_id)`, now.hour);
  let sent = 0;
  for (const r of rows) {
    const prefs = { days: JSON.parse(r.days), hour: r.hour };
    const log = await s.first('SELECT 1 AS x FROM student_push_log WHERE student_id = ? AND date = ?', r.student_id, now.date);
    const dates = (await s.all('SELECT DISTINCT local_date FROM practice_sessions WHERE student_id = ? AND local_date >= ?', r.student_id, addDays(now.date, -400))).map((x) => x.local_date);
    const target = (await s.first('SELECT days FROM student_streak WHERE student_id = ?', r.student_id) || {}).days || 3;
    const msg = reminderText({ name: r.first_name, prefs, now, dates, target, sentToday: !!log });
    if (!msg) continue;
    await s.run('INSERT OR IGNORE INTO student_push_log (student_id, date, kind) VALUES (?, ?, ?)', r.student_id, now.date, msg.kind);
    const subs = await s.all('SELECT * FROM student_push_subs WHERE student_id = ?', r.student_id);
    for (const x of subs) {
      let res; try { res = await sendFn(x, { title: msg.title, body: msg.body, tag: 'ueben', url: './', ts: Date.now() }); } catch (e) { res = { ok: false }; }
      if (res.gone || (!res.ok && x.fails >= 9)) await s.run('DELETE FROM student_push_subs WHERE id = ?', x.id);
      else if (res.ok) { sent++; await s.run('UPDATE student_push_subs SET last_ok = ?, fails = 0 WHERE id = ?', new Date().toISOString(), x.id); }
      else await s.run('UPDATE student_push_subs SET fails = fails + 1 WHERE id = ?', x.id);
    }
  }
  return { checked: rows.length, sent };
}
