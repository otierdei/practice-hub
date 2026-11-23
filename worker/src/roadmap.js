// Song Roadmap: ein Chart für Schlagzeug und Gitarre (Teile, Takte, Akkorde, Drum Marken, Ablauf)
// Format v1:
// { kind:'roadmap', v:1, sig:'4/4'|'3/4'|'6/8'|'12/8', bpm, key,
//   sections:[{ id, type, name, bars:[{ c:[Akkorde, max 4], m:[Marken], t:'Notiz' }] }],
//   order:[{ s:Teil id, x:Wiederholungen 1..8, feel:'n'|'h'|'d', dyn:'', note:'' }] }
// Teile werden einmal definiert, der Ablauf ruft sie auf (wie ein Cheat Sheet: I V C V C C B C O).

export const ROADMAP_SCHEMA = `
-- Song Roadmap (Form, Akkorde pro Takt, Drum Marken, Ablauf) als JSON, ein Chart für alle Instrumente
CREATE TABLE IF NOT EXISTS song_roadmap (
  song_id TEXT PRIMARY KEY,
  roadmap TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const SECTION_TYPES = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'turnaround', 'tag', 'outro', 'other'];
export const MARKS = ['hit', 'fill', 'stop', 'crash', 'build', 'cue'];
export const FEELS = ['n', 'h', 'd'];
export const DYNS = ['', 'pp', 'p', 'mf', 'f', 'ff', 'build', 'drop'];
export const LIMITS = { sections: 16, bars: 32, order: 40, chords: 4, total: 400 };

// Akkordsymbol: G, F#m7, Bbmaj7, Dsus4, C/E, Asus, Gadd9, N.C. oder % (wie Takt davor)
const CHORD = /^(?:N\.C\.|%|[A-G][#b]?[a-z0-9#b+°ø()]{0,10}(?:\/[A-G][#b]?)?)$/;

const s = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const n = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };

export function cleanChord(c) {
  const t = s(c, 20).replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '').replace(/^nc$/i, 'N.C.');
  return CHORD.test(t) ? t : null;
}

// Liefert sauberes JSON oder wirft einen Fehler mit deutschem Text (wird als 400 gemeldet)
export function cleanRoadmap(input) {
  let o = input;
  if (typeof o === 'string') { if (o.length > 60000) throw new Error('Roadmap zu groß.'); try { o = JSON.parse(o); } catch (e) { throw new Error('Roadmap ist beschädigt.'); } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Roadmap ist beschädigt.');
  const sig = ['4/4', '3/4', '6/8', '12/8'].includes(o.sig) ? o.sig : '4/4';
  const bpm = n(o.bpm, 30, 300);
  const k0 = s(o.key, 4).replace(/♯/g, '#').replace(/♭/g, 'b');
  const key = /^[A-G][#b]?m?$/.test(k0) ? k0 : '';
  const ids = new Set();
  const bad = [];
  const sections = (Array.isArray(o.sections) ? o.sections : []).slice(0, LIMITS.sections).map((x, i) => {
    let id = s(x && x.id, 8).toLowerCase().replace(/[^a-z0-9]/g, '') || 's' + (i + 1);
    while (ids.has(id)) id = id.slice(0, 6) + (i + 1);
    ids.add(id);
    const type = SECTION_TYPES.includes(x && x.type) ? x.type : 'other';
    const bars = (Array.isArray(x && x.bars) ? x.bars : []).slice(0, LIMITS.bars).map((b) => {
      const c = (Array.isArray(b && b.c) ? b.c : []).slice(0, LIMITS.chords).map((ch) => {
        const ok = cleanChord(ch); if (ch && !ok) bad.push(s(ch, 20)); return ok;
      }).filter(Boolean);
      const m = [...new Set((Array.isArray(b && b.m) ? b.m : []).filter((v) => MARKS.includes(v)))];
      const t = s(b && b.t, 40);
      return { c, ...(m.length ? { m } : {}), ...(t ? { t } : {}) };
    });
    if (!bars.length) bars.push({ c: [] });
    return { id, type, name: s(x && x.name, 30), bars };
  });
  if (bad.length) throw new Error('Unbekannte Akkorde: ' + [...new Set(bad)].slice(0, 5).join(', '));
  if (!sections.length) throw new Error('Die Roadmap braucht mindestens einen Teil.');
  let total = 0;
  const order = (Array.isArray(o.order) ? o.order : []).slice(0, LIMITS.order).map((x) => {
    const sec = sections.find((y) => y.id === s(x && x.s, 8).toLowerCase());
    if (!sec) return null;
    const rep = n(x.x, 1, 8) || 1;
    total += sec.bars.length * rep;
    const feel = FEELS.includes(x.feel) ? x.feel : 'n';
    const dyn = DYNS.includes(x.dyn) ? x.dyn : '';
    const note = s(x.note, 60);
    return { s: sec.id, x: rep, ...(feel !== 'n' ? { feel } : {}), ...(dyn ? { dyn } : {}), ...(note ? { note } : {}) };
  }).filter(Boolean);
  if (!order.length) for (const sec of sections) { order.push({ s: sec.id, x: 1 }); total += sec.bars.length; }
  if (total > LIMITS.total) throw new Error('Die Roadmap ist zu lang (höchstens ' + LIMITS.total + ' Takte).');
  return JSON.stringify({ kind: 'roadmap', v: 1, sig, ...(bpm ? { bpm } : {}), ...(key ? { key } : {}), sections, order });
}
