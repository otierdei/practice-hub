// Missionen (19.11.2026): Paket aus Schritten mit einem Ziel (Song oder Skill).
// Oti baut eine Mission einmal als Vorlage und gibt sie Schülern auf. Jeder freie Schritt wird eine normale Hausaufgabe,
// damit Tour, Übungsringe und Protokoll ohne Umbau funktionieren. Der Schüler hakt ab ("fertig melden"),
// Oti schließt die Hausaufgabe, dann wird der nächste Schritt frei.

export const MISSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT,
  instrument TEXT NOT NULL DEFAULT 'drums',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_steps (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  sort INTEGER NOT NULL,
  title TEXT NOT NULL,
  item TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS student_missions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS student_mission_steps (
  student_mission_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  assignment_id TEXT,
  status TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (student_mission_id, step_id)
);
CREATE INDEX IF NOT EXISTS i_mission_steps ON mission_steps(mission_id, sort);
CREATE INDEX IF NOT EXISTS i_student_missions ON student_missions(student_id, status);
`;

export const MISSION_INSTR = { drums: 'Schlagzeug', guitar: 'Gitarre' };
const KINDS = ['part', 'song', 'exercise', 'text'];

// Darf der Schüler diese Mission bekommen? Reine Gitarrenschüler nur Gitarre, reine Schlagzeuger nur Schlagzeug.
export function instrumentFits(studentInstrument, missionInstrument) {
  const i = String(studentInstrument || 'Schlagzeug');
  if (missionInstrument === 'guitar') return /Gitarre/.test(i);
  return /Schlagzeug/.test(i) || !/Gitarre/.test(i);
}

export function missionDeleteStudentStatements(studentId) {
  return [
    ['DELETE FROM student_mission_steps WHERE student_mission_id IN (SELECT id FROM student_missions WHERE student_id = ?)', [studentId]],
    ['DELETE FROM student_missions WHERE student_id = ?', [studentId]],
  ];
}

// h: { s, who, now, uid, str, int, HttpError, logRow, newAssignmentStatements, orderAppend, cleanUrl }
export function missionApi(h) {
  const { s, str, int, HttpError } = h;
  const parse = (x) => { try { return JSON.parse(x); } catch (e) { return {}; } };

  async function templates() {
    const [ms, steps, use] = await Promise.all([
      s.all('SELECT id, title, goal, instrument, created_at FROM missions WHERE archived = 0 ORDER BY created_at DESC'),
      s.all('SELECT id, mission_id, sort, title, item FROM mission_steps ORDER BY mission_id, sort'),
      s.all("SELECT sm.mission_id, sm.status, st.first_name FROM student_missions sm JOIN students st ON st.id = sm.student_id ORDER BY sm.started_at"),
    ]);
    for (const m of ms) {
      m.steps = steps.filter((x) => x.mission_id === m.id).map((x) => ({ id: x.id, sort: x.sort, title: x.title, item: parse(x.item) }));
      m.students = use.filter((u) => u.mission_id === m.id).map((u) => ({ name: u.first_name, status: u.status }));
    }
    return { missions: ms };
  }

  async function save(b) {
    const title = str(b.title, 80); if (!title) throw new HttpError(400, 'Gib der Mission einen Namen.');
    const instrument = b.instrument === 'guitar' ? 'guitar' : 'drums';
    const goal = str(b.goal, 300);
    if (b.id) {
      const m = await s.first('SELECT id FROM missions WHERE id = ?', String(b.id));
      if (!m) throw new HttpError(404, 'Mission nicht gefunden.');
      await s.batch([['UPDATE missions SET title = ?, goal = ?, instrument = ? WHERE id = ?', [title, goal, instrument, m.id]], h.logRow(h.who, 'update', 'missions', m.id, 'Mission: ' + title)]);
      return { id: m.id };
    }
    const id = h.uid();
    await s.batch([['INSERT INTO missions (id, title, goal, instrument, created_at) VALUES (?, ?, ?, ?, ?)', [id, title, goal, instrument, h.now()]], h.logRow(h.who, 'create', 'missions', id, 'Mission: ' + title)]);
    return { id };
  }

  // Schritt prüfen und Titel ableiten: Baustein, ganzer Song, Übung aus der Bibliothek oder freier Text
  async function cleanItem(b) {
    const kind = KINDS.includes(b.kind) ? b.kind : null; if (!kind) throw new HttpError(400, 'Art des Schritts fehlt.');
    const tempo = { start_bpm: int(b.start_bpm, 20, 400), target_bpm: int(b.target_bpm, 20, 400), minutes_per_day: int(b.minutes_per_day, 1, 240) || 10 };
    if (kind === 'part') {
      const p = await s.first('SELECT p.id, p.song_id, p.title, sg.title AS song_title FROM song_parts p JOIN songs sg ON sg.id = p.song_id WHERE p.id = ?', String(b.part_id || ''));
      if (!p) throw new HttpError(404, 'Baustein nicht gefunden.');
      return { title: p.song_title + ': ' + p.title, item: { kind, part_id: p.id, song_id: p.song_id, ...tempo } };
    }
    if (kind === 'song') {
      const sg = await s.first('SELECT id, title FROM songs WHERE id = ?', String(b.song_id || ''));
      if (!sg) throw new HttpError(404, 'Song nicht gefunden.');
      const version = str(b.version, 40);
      return { title: sg.title + (version ? ' (' + version + ')' : ''), item: { kind, song_id: sg.id, version, minutes_per_day: tempo.minutes_per_day } };
    }
    if (kind === 'exercise') {
      const e = await s.first('SELECT id, title FROM exercises WHERE id = ?', String(b.exercise_id || ''));
      if (!e) throw new HttpError(404, 'Übung nicht gefunden.');
      return { title: e.title, item: { kind, exercise_id: e.id, ...tempo } };
    }
    const text = str(b.free_text, 300); if (!text) throw new HttpError(400, 'Text fehlt.');
    return { title: text, item: { kind, free_text: text, url: h.cleanUrl(b.url), ...tempo } };
  }

  async function stepAdd(b) {
    const m = await s.first('SELECT id FROM missions WHERE id = ?', String(b.mission_id || ''));
    if (!m) throw new HttpError(404, 'Mission nicht gefunden.');
    const n = await s.first('SELECT COUNT(*) AS n, COALESCE(MAX(sort) + 1, 0) AS next FROM mission_steps WHERE mission_id = ?', m.id);
    if (n.n >= 20) throw new HttpError(400, 'Höchstens 20 Schritte pro Mission.');
    const { title, item } = await cleanItem(b);
    const id = h.uid();
    await s.run('INSERT INTO mission_steps (id, mission_id, sort, title, item, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, m.id, n.next, str(b.title, 160) || title, JSON.stringify(item), h.now());
    return { id };
  }

  async function stepDelete(b) {
    const st = await s.first('SELECT id FROM mission_steps WHERE id = ?', String(b.id || ''));
    if (!st) throw new HttpError(404, 'Schritt nicht gefunden.');
    await s.batch([['DELETE FROM mission_steps WHERE id = ?', [st.id]], ['DELETE FROM student_mission_steps WHERE step_id = ?', [st.id]]]);
    return { ok: true };
  }

  async function stepsReorder(b) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 40).map(String);
    const own = new Set((await s.all('SELECT id FROM mission_steps WHERE mission_id = ?', String(b.mission_id || ''))).map((x) => x.id));
    if (!ids.length || ids.length !== own.size || ids.some((x) => !own.has(x))) throw new HttpError(400, 'Schritte passen nicht zur Mission.');
    await s.batch(ids.map((x, i) => ['UPDATE mission_steps SET sort = ? WHERE id = ?', [i, x]]));
    return { ok: true };
  }

  async function archive(b) {
    const m = await s.first('SELECT id, title FROM missions WHERE id = ?', String(b.id || ''));
    if (!m) throw new HttpError(404, 'Mission nicht gefunden.');
    await s.batch([['UPDATE missions SET archived = 1 WHERE id = ?', [m.id]], h.logRow(h.who, 'archive', 'missions', m.id, 'Mission archiviert: ' + m.title)]);
    return { ok: true };
  }

  // Offene Hausaufgabe, die schon genau diesen Schritt abdeckt (dann wird sie verknüpft statt doppelt angelegt)
  async function openMatch(studentId, item) {
    if (item.kind === 'part') return s.first("SELECT a.id FROM assignments a JOIN assignment_parts ap ON ap.assignment_id = a.id WHERE a.student_id = ? AND a.status = 'offen' AND ap.part_id = ?", studentId, item.part_id);
    if (item.kind === 'exercise') return s.first("SELECT id FROM assignments WHERE student_id = ? AND status = 'offen' AND exercise_id = ?", studentId, item.exercise_id);
    if (item.kind === 'song') {
      const rows = await s.all("SELECT a.id, x.version FROM assignments a JOIN assignment_songs x ON x.assignment_id = a.id LEFT JOIN assignment_parts ap ON ap.assignment_id = a.id WHERE a.student_id = ? AND a.status = 'offen' AND x.song_id = ? AND ap.part_id IS NULL", studentId, item.song_id);
      return rows.find((r) => String(r.version || '').toLowerCase() === String(item.version || '').toLowerCase()) || null;
    }
    const rows = await s.all("SELECT id, free_text FROM assignments WHERE student_id = ? AND status = 'offen'", studentId);
    const want = String(item.free_text || '').trim().toLowerCase();
    return rows.find((r) => String(r.free_text || '').trim().toLowerCase() === want) || null;
  }

  // Schritt freischalten: normale Hausaufgabe anlegen (oder vorhandene verknüpfen)
  async function unlock(st, smId, step) {
    const t = h.now(), item = parse(step.item), stmts = [];
    const { newIds } = await h.newAssignmentStatements(s, st, null, [item], new Set(), t, stmts);
    let aid = newIds[0] || null;
    if (!aid) { const m = await openMatch(st.id, item); aid = m ? m.id : null; }
    stmts.push(['INSERT OR IGNORE INTO student_mission_steps (student_mission_id, step_id, assignment_id, status, unlocked_at) VALUES (?, ?, ?, ?, ?)', [smId, step.id, aid, aid ? 'offen' : 'fertig', t]]);
    await s.batch(stmts);
    if (newIds.length) { const ord = await h.orderAppend(s, st.id, newIds); if (ord.length) await s.batch(ord); }
    return aid;
  }

  async function assign(b) {
    const m = await s.first('SELECT id, title, instrument FROM missions WHERE id = ? AND archived = 0', String(b.mission_id || ''));
    if (!m) throw new HttpError(404, 'Mission nicht gefunden.');
    const steps = await s.all('SELECT id, title, item FROM mission_steps WHERE mission_id = ? ORDER BY sort', m.id);
    if (!steps.length) throw new HttpError(400, 'Die Mission hat noch keine Schritte.');
    const ids = [...new Set((Array.isArray(b.student_ids) ? b.student_ids : [b.student_id]).filter(Boolean).map(String))].slice(0, 40);
    if (!ids.length) throw new HttpError(400, 'Wähle mindestens einen Schüler.');
    const done = [], skipped = [];
    for (const id of ids) {
      const st = await s.first('SELECT id, first_name, instrument FROM students WHERE id = ?', id);
      if (!st) throw new HttpError(404, 'Schüler nicht gefunden.');
      if (!instrumentFits(st.instrument, m.instrument)) { skipped.push(st.first_name + ' (spielt kein ' + MISSION_INSTR[m.instrument] + ')'); continue; }
      if (await s.first("SELECT id FROM student_missions WHERE student_id = ? AND mission_id = ? AND status = 'aktiv'", st.id, m.id)) { skipped.push(st.first_name + ' (läuft schon)'); continue; }
      const smId = h.uid();
      await s.batch([['INSERT INTO student_missions (id, mission_id, student_id, status, started_at) VALUES (?, ?, ?, ?, ?)', [smId, m.id, st.id, 'aktiv', h.now()]], h.logRow(h.who, 'create', 'student_missions', smId, 'Mission ' + m.title + ' an ' + st.first_name)]);
      await unlock(st, smId, steps[0]);
      await sync(st.id);
      done.push(st.first_name);
    }
    return { assigned: done, skipped };
  }

  async function cancel(b) {
    const sm = await s.first('SELECT id FROM student_missions WHERE id = ?', String(b.id || ''));
    if (!sm) throw new HttpError(404, 'Mission nicht gefunden.');
    // Offene Hausaufgaben bleiben als normale Hausaufgaben stehen
    await s.batch([['DELETE FROM student_mission_steps WHERE student_mission_id = ?', [sm.id]], ['DELETE FROM student_missions WHERE id = ?', [sm.id]], h.logRow(h.who, 'delete', 'student_missions', sm.id, 'Mission beendet')]);
    return { ok: true };
  }

  // Fortschritt nachziehen: geschlossene oder gelöschte Hausaufgabe = Schritt fertig, dann nächsten Schritt freischalten.
  // Wird nach jedem Schließen, Wiederöffnen oder Löschen einer Hausaufgabe aufgerufen. Idempotent.
  async function sync(studentId) {
    const st = await s.first('SELECT id, first_name, instrument FROM students WHERE id = ?', String(studentId || ''));
    if (!st) return;
    const sms = await s.all("SELECT sm.id, sm.mission_id, m.title FROM student_missions sm JOIN missions m ON m.id = sm.mission_id WHERE sm.student_id = ? AND sm.status = 'aktiv'", st.id);
    for (const sm of sms) {
      for (let guard = 0; guard < 25; guard++) {
        const steps = await s.all('SELECT id, title, item FROM mission_steps WHERE mission_id = ? ORDER BY sort', sm.mission_id);
        const rows = await s.all('SELECT r.step_id, r.assignment_id, r.status, a.status AS a_status, a.id AS a_id FROM student_mission_steps r LEFT JOIN assignments a ON a.id = r.assignment_id WHERE r.student_mission_id = ?', sm.id);
        const t = h.now(), ops = [];
        for (const r of rows) {
          const closed = !r.a_id || r.a_status === 'erledigt';
          if (r.status === 'offen' && closed) ops.push(['UPDATE student_mission_steps SET status = ?, done_at = ? WHERE student_mission_id = ? AND step_id = ?', ['fertig', t, sm.id, r.step_id]]);
          if (r.status === 'fertig' && !closed) ops.push(['UPDATE student_mission_steps SET status = ?, done_at = NULL WHERE student_mission_id = ? AND step_id = ?', ['offen', sm.id, r.step_id]]);
        }
        if (ops.length) { await s.batch(ops); continue; }
        if (rows.some((r) => r.status === 'offen')) break;
        const have = new Set(rows.map((r) => r.step_id));
        const next = steps.find((x) => !have.has(x.id));
        if (next) { await unlock(st, sm.id, next); continue; }
        if (steps.length) await s.batch([["UPDATE student_missions SET status = 'fertig', done_at = ? WHERE id = ?", [t, sm.id]], h.logRow({ role: 'system' }, 'done', 'student_missions', sm.id, st.first_name + ' hat die Mission ' + sm.title + ' geschafft')]);
        break;
      }
    }
  }

  // Missionen eines Schülers mit Schrittstatus: fertig, offen (mit Schüler Haken = gemeldet) oder gesperrt
  async function forStudent(studentId) {
    const sms = await s.all('SELECT sm.id, sm.mission_id, sm.status, sm.started_at, sm.done_at, m.title, m.goal, m.instrument FROM student_missions sm JOIN missions m ON m.id = sm.mission_id WHERE sm.student_id = ? ORDER BY sm.status, sm.started_at DESC', String(studentId));
    if (!sms.length) return [];
    const steps = await s.all(`SELECT id, mission_id, title, item FROM mission_steps WHERE mission_id IN (${sms.map(() => '?').join(',')}) ORDER BY sort`, ...sms.map((x) => x.mission_id));
    const rows = await s.all(`SELECT r.student_mission_id, r.step_id, r.assignment_id, r.status, c.student_done_at FROM student_mission_steps r LEFT JOIN assignment_checks c ON c.assignment_id = r.assignment_id WHERE r.student_mission_id IN (${sms.map(() => '?').join(',')})`, ...sms.map((x) => x.id));
    return sms.map((sm) => {
      const mine = rows.filter((r) => r.student_mission_id === sm.id);
      const list = steps.filter((x) => x.mission_id === sm.mission_id).map((x) => {
        const r = mine.find((y) => y.step_id === x.id), kind = parse(x.item).kind;
        return { id: x.id, title: x.title, kind, status: sm.status === 'fertig' ? 'fertig' : r ? r.status : 'gesperrt', assignment_id: r ? r.assignment_id : null, reported: !!(r && r.status === 'offen' && r.student_done_at) };
      });
      return { id: sm.id, mission_id: sm.mission_id, title: sm.title, goal: sm.goal, instrument: sm.instrument, status: sm.status, started_at: sm.started_at, done_at: sm.done_at, steps: list, done: list.filter((x) => x.status === 'fertig').length, total: list.length };
    });
  }

  return { templates, save, stepAdd, stepDelete, stepsReorder, archive, assign, cancel, sync, forStudent };
}
