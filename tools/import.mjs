// Importiert Schüler und alte Stunden aus einer JSON Datei (liegt NICHT im Repo).
// node tools/import.mjs <seed.json> <api> <lehrercode>
import { readFile } from 'node:fs/promises';
const [file, API, CODE] = process.argv.slice(2);
if (!file || !API || !CODE) { console.error('Aufruf: node tools/import.mjs seed.json https://api lehrercode'); process.exit(1); }
const seed = JSON.parse(await readFile(file, 'utf8'));
const origin = process.env.ORIGIN || 'https://otierdei.github.io';
async function call(path, body, token) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(path + ': ' + (d.error || r.status)); return d;
}
const { token } = await call('/api/login', { code: CODE });
const existing = (await call('/api/home', {}, token)).students.map((s) => s.first_name);
let lessons = 0, tasks = 0;
for (const st of seed) {
  if (existing.includes(st.first_name)) { console.log('übersprungen, existiert schon:', st.first_name); continue; }
  const { id } = await call('/api/t/student/save', { first_name: st.first_name, weekday: st.weekday, lesson_time: st.lesson_time, lesson_minutes: st.lesson_minutes, instrument: st.instrument, profile_note: st.profile_note }, token);
  for (let i = 0; i < st.lessons.length; i += 150) {
    const last = i + 150 >= st.lessons.length;
    const r = await call('/api/t/import/lessons', { student_id: id, lessons: st.lessons.slice(i, i + 150), assignments: last ? st.assignments : [] }, token);
    lessons += r.imported; tasks += r.assignments;
  }
  console.log('ok', st.first_name, st.lessons.length, 'Stunden');
}
await call('/api/logout', {}, token);
console.log(`FERTIG: ${seed.length} Schüler, ${lessons} Stunden, ${tasks} Hausaufgaben`);
