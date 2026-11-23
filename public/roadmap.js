// Song Roadmap: gemeinsame Logik für Schlagzeug und Gitarre (Ablauf, Cheat Sheet, Transponieren, Nashville, Capo)
// Format siehe worker/src/roadmap.js. Läuft im Browser (window.Roadmap) und in Node (module.exports) für Tests.
(function (root) {
  const TYPES = {
    intro: { label: 'Intro', short: 'I' }, verse: { label: 'Strophe', short: 'V' }, prechorus: { label: 'Pre Chorus', short: 'PC' },
    chorus: { label: 'Chorus', short: 'C' }, bridge: { label: 'Bridge', short: 'B' }, interlude: { label: 'Zwischenspiel', short: 'Int' },
    turnaround: { label: 'Turnaround', short: 'TA' }, tag: { label: 'Tag', short: 'Tag' }, outro: { label: 'Outro', short: 'O' }, other: { label: 'Teil', short: 'T' },
  };
  const MARKS = { hit: 'Hit', fill: 'Fill', stop: 'Stopp', crash: 'Crash', build: 'Aufbauen', cue: 'Einsatz' };
  const FEELS = { n: 'Normal', h: 'Halftime', d: 'Doubletime' };
  const DYNS = { pp: 'sehr leise', p: 'leise', mf: 'mittel', f: 'laut', ff: 'sehr laut', build: 'aufbauen', drop: 'zurücknehmen' };

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Tonarten, die mit b geschrieben werden (Dur und Moll)
  const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'];
  const pc = (note) => { const i = SHARP.indexOf(note); return i >= 0 ? i : FLAT.indexOf(note); };
  const ROOT = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;

  function keyIndex(key) { const m = /^([A-G][#b]?)/.exec(key || ''); return m ? pc(m[1]) : -1; }
  function useFlats(key) { return FLAT_KEYS.includes(key); }
  function transposeKey(key, semis) {
    const m = /^([A-G][#b]?)(m?)$/.exec(key || ''); if (!m) return key || '';
    const i = (pc(m[1]) + semis + 120) % 12;
    const sharp = SHARP[i] + m[2], flat = FLAT[i] + m[2];
    return FLAT_KEYS.includes(flat) ? flat : sharp;
  }
  function transposeNote(note, semis, flats) { const i = pc(note); if (i < 0) return note; return (flats ? FLAT : SHARP)[(i + semis + 120) % 12]; }
  function transposeChord(chord, semis, flats) {
    if (!chord || chord === '%' || chord === 'N.C.' || !semis) return chord;
    const m = ROOT.exec(chord); if (!m) return chord;
    return transposeNote(m[1], semis, flats) + m[2] + (m[3] ? '/' + transposeNote(m[3], semis, flats) : '');
  }
  // Nashville Zahl relativ zur Tonart: in G ist Em = 6m, D/F# = 5/7
  const DEG = { 0: '1', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7' };
  function nashville(chord, key) {
    if (!chord || chord === '%' || chord === 'N.C.') return chord;
    const k = keyIndex(key); const m = ROOT.exec(chord); if (k < 0 || !m) return chord;
    const minorKey = /m$/.test(key);
    const tonic = minorKey ? (k + 3) % 12 : k; // Moll Tonart: Zahlen relativ zur relativen Dur Tonart (Em in G: Em = 6m, wie in Worship Charts üblich)
    const deg = (n) => DEG[(pc(n) - tonic + 12) % 12];
    return deg(m[1]) + m[2] + (m[3] ? '/' + deg(m[3]) : '');
  }
  // Capo Vorschläge: welche offenen Griffe (G, C, D, A, E) mit welchem Bund die Tonart ergeben
  function capoOptions(key) {
    const m = /^([A-G][#b]?)(m?)$/.exec(key || ''); if (!m) return [];
    const k = pc(m[1]); const minor = m[2] === 'm';
    const shapes = minor ? ['Em', 'Am', 'Dm'] : ['G', 'C', 'D', 'A', 'E'];
    return shapes.map((sh) => ({ shape: sh, capo: (k - pc(sh.replace('m', '')) + 12) % 12 })).filter((x) => x.capo <= 7).sort((a, b) => a.capo - b.capo);
  }
  // Griffe mit Capo: klingende Akkorde um capo Halbtöne nach unten für die Griffhand
  function shapeChord(chord, capo, shapeKey) { return transposeChord(chord, -(capo || 0), useFlats(shapeKey)); }

  function section(rm, id) { return (rm.sections || []).find((s) => s.id === id); }
  function label(sec) { return (sec && (sec.name || (TYPES[sec.type] || TYPES.other).label)) || 'Teil'; }
  function short(sec, rm) {
    const t = TYPES[sec.type] || TYPES.other;
    const same = (rm.sections || []).filter((s) => s.type === sec.type);
    if (same.length < 2) return t.short;
    const num = /(\d+)\s*$/.exec(sec.name || '');
    return t.short + (num ? num[1] : same.indexOf(sec) + 1);
  }
  // Cheat Sheet Kurzform: "I V1 C V2 C x2 B C O"
  function cheatSheet(rm) {
    return (rm.order || []).map((o) => { const sec = section(rm, o.s); return sec ? short(sec, rm) + (o.x > 1 ? ' x' + o.x : '') : ''; }).filter(Boolean).join(' ');
  }
  // Ablauf in einzelne Takte auflösen; "%" übernimmt die Akkorde des Takts davor
  function expand(rm) {
    const out = []; let prev = [];
    (rm.order || []).forEach((o, oi) => {
      const sec = section(rm, o.s); if (!sec) return;
      for (let pass = 0; pass < (o.x || 1); pass++) {
        sec.bars.forEach((b, bi) => {
          let c = (b.c || []).flatMap((ch) => (ch === '%' ? prev : [ch]));
          if (c.length) prev = c;
          out.push({ i: out.length, order: oi, pass, bar: bi, section: sec.id, type: sec.type, name: label(sec), first: bi === 0, chords: c, marks: b.m || [], text: b.t || '', feel: o.feel || 'n', dyn: o.dyn || '', note: bi === 0 && pass === 0 ? (o.note || '') : '' });
        });
      }
    });
    return out;
  }
  function beatsPerBar(sig) { return { '3/4': 3, '6/8': 6, '12/8': 12 }[sig] || 4; }
  function totalBars(rm) { return expand(rm).length; }
  // Länge in Sekunden bei bpm (6/8 und 12/8 zählen Achtel, wie im Metronom)
  function duration(rm, bpm) { const b = bpm || rm.bpm || 80; return Math.round(totalBars(rm) * beatsPerBar(rm.sig) * 60 / b); }
  // Für "Transponieren üben": alle 12 Tonarten im Quintenzirkel ab der Original Tonart
  function keyCycle(key) { const out = [key]; let k = key; for (let i = 0; i < 11; i++) { k = transposeKey(k, 7); out.push(k); } return out; }
  function empty() {
    return { kind: 'roadmap', v: 1, sig: '4/4', sections: [
      { id: 'i', type: 'intro', name: '', bars: [{ c: [] }, { c: [] }, { c: [] }, { c: [] }] },
      { id: 'v', type: 'verse', name: '', bars: Array.from({ length: 8 }, () => ({ c: [] })) },
      { id: 'c', type: 'chorus', name: '', bars: Array.from({ length: 8 }, () => ({ c: [] })) },
      { id: 'b', type: 'bridge', name: '', bars: Array.from({ length: 8 }, () => ({ c: [] })) },
    ], order: [{ s: 'i', x: 1 }, { s: 'v', x: 1 }, { s: 'c', x: 1 }, { s: 'v', x: 1 }, { s: 'c', x: 2 }, { s: 'b', x: 2, dyn: 'build' }, { s: 'c', x: 2, dyn: 'f' }] };
  }

  const api = { TYPES, MARKS, FEELS, DYNS, transposeKey, transposeChord, nashville, capoOptions, shapeChord, useFlats, keyIndex, cheatSheet, expand, totalBars, duration, beatsPerBar, keyCycle, label, short, section, empty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Roadmap = api;
})(typeof window !== 'undefined' ? window : globalThis);
