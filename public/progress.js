// Fortschritt (23.11.2026): Wochen Serie mit Zieltagen pro Schüler, BW Schulferien pausieren die Serie, Monatskalender
// Läuft im Browser (window.Progress) und in Node (module.exports) für Tests.
(function (root) {
  // Schulferien Baden-Württemberg (erster und letzter Ferientag), Quelle: Kultusministerium BW über Ferienkalender, geprüft 23.11.2026
  const HOLIDAYS_BW = [
    ['2025-12-22', '2026-01-05'], ['2026-03-30', '2026-04-11'], ['2026-05-26', '2026-06-05'], ['2026-07-30', '2026-09-12'],
    ['2026-10-26', '2026-10-31'], ['2026-12-23', '2027-01-09'], ['2027-03-25', '2027-03-25'], ['2027-03-30', '2027-04-03'],
    ['2027-05-18', '2027-05-29'], ['2027-07-29', '2027-09-11'], ['2027-11-02', '2027-11-06'], ['2027-12-23', '2028-01-08'],
  ];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => new Date(s + 'T12:00:00');
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const monday = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const isHoliday = (s) => HOLIDAYS_BW.some(([a, b]) => s >= a && s <= b);
  // Ferienwoche: mindestens 3 Schultage (Mo bis Fr) sind Ferien
  const holidayWeek = (mon) => [0, 1, 2, 3, 4].filter((i) => isHoliday(addDays(mon, i))).length >= 3;
  function weekDays(mon) { return Array.from({ length: 7 }, (_, i) => addDays(mon, i)); }

  // Serie: Woche zählt, wenn Zieltage erreicht. Ferienwochen ohne Ziel unterbrechen nicht (Pause). Laufende Woche bricht nie.
  function streak(dates, target, today) {
    const t = Math.max(1, Math.min(7, target || 3));
    const played = new Set(dates);
    const now = monday(today);
    const count = (mon) => weekDays(mon).filter((d) => played.has(d) && d <= today).length;
    const cur = { days: weekDays(now).map((d) => ({ date: d, played: played.has(d), today: d === today, future: d > today, holiday: isHoliday(d) })), n: count(now), target: t, holiday: holidayWeek(now) };
    cur.done = cur.n >= t;
    let weeks = cur.done ? 1 : 0, paused = 0;
    for (let i = 1; i < 260; i++) {
      const mon = addDays(now, -7 * i);
      if (count(mon) >= t) { weeks++; continue; }
      if (holidayWeek(mon)) { paused++; continue; }
      break;
    }
    // Längste Serie im gesamten Verlauf (gleiche Regeln)
    const first = dates.length ? monday([...dates].sort()[0]) : now;
    let best = 0, run = 0;
    for (let mon = first; mon <= now; mon = addDays(mon, 7)) {
      if (count(mon) >= t) { run++; best = Math.max(best, run); }
      else if (holidayWeek(mon) || mon === now) { /* Pause oder laufende Woche */ }
      else run = 0;
    }
    return { weeks, best: Math.max(best, weeks), paused, current: cur, left: Math.max(0, t - cur.n) };
  }
  // Längste Folge von Übetagen (nur als Statistik)
  function dayStreakBest(dates) {
    const s = [...new Set(dates)].sort(); let best = 0, run = 0, prev = null;
    for (const d of s) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    return best;
  }
  // Monatsraster ab Montag: [{date, inMonth, played, minutes, holiday, today}]
  function month(year, m, minutesByDate, today) {
    const first = ymd(new Date(year, m, 1, 12)); const start = monday(first);
    const last = ymd(new Date(year, m + 1, 0, 12));
    const cells = [];
    for (let d = start; d <= last || cells.length % 7; d = addDays(d, 1)) {
      cells.push({ date: d, inMonth: d.slice(0, 7) === first.slice(0, 7), minutes: minutesByDate[d] || 0, played: !!minutesByDate[d], holiday: isHoliday(d), today: d === today, future: d > today });
    }
    return cells;
  }
  const api = { HOLIDAYS_BW, isHoliday, holidayWeek, monday, addDays, streak, dayStreakBest, month, ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Progress = api;
})(typeof window !== 'undefined' ? window : globalThis);
