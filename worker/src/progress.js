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
