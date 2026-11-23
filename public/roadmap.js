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
    const tonic = k; // Moll Tonart zählt vom Moll Grundton (Blue Bossa in Cm: Cm7 = 1m7)
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
    if (sec.type === 'other' && sec.name && sec.name.length <= 10) return sec.name; // Jazz Formteile A, B, A1, Blues
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


  // iReal Pro Import: irealb:// oder irealbook:// Link (Song oder Playlist) → [{ title, composer, roadmap }]
  // Gleiches Verfahren wie tools/ireal/decode.py und to_roadmap.py
  function irealUnscramble(s) {
    const obf = (x) => { const n = x.split(''); for (const i of [0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) { n[49 - i] = x[i]; n[i] = x[49 - i]; } return n.join(''); };
    let r = '', p = s;
    while (p.length > 50) { const seg = p.slice(0, 50); p = p.slice(50); r += p.length < 2 ? seg : obf(seg); }
    return r + p;
  }
  const QMAP = [['-^7', 'm(maj7)'], ['^7', 'maj7'], ['^9', 'maj9'], ['^', 'maj7'], ['h7', 'm7b5'], ['h', 'm7b5'], ['o7', 'dim7'], ['o', 'dim']];
  function irealChord(t) {
    const m = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(t); if (!m) return null;
    let q = m[2]; const hit = QMAP.find(([a]) => q.startsWith(a));
    if (hit) q = hit[1] + q.slice(hit[0].length); else if (q.startsWith('-')) q = 'm' + q.slice(1);
    return m[1] + q + (m[3] ? '/' + m[3] : '');
  }
  function irealSong(f) {
    const music = f.find((x) => x.startsWith('1r34LbKcu7')); if (!music) return null;
    let m = irealUnscramble(music.slice(10)).replace(/XyQ/g, '   ').replace(/LZ/g, ' |').replace(/Kcl/g, '| x');
    m = m.replace(/\([^)]*\)/g, '').replace(/<[^>]*>/g, '');
    const ts = /T(\d)(\d)/.exec(m); const sig = ts ? ({ 44: '4/4', 34: '3/4', 68: '6/8', 12: '12/8' }[ts[1] + ts[2]] || '4/4') : '4/4';
    m = m.replace(/T\d\d/g, '').replace(/[USQfslY]/g, '');
    const ev = []; let cur = [];
    const flush = () => { const t = cur.join(' ').trim(); if (t) ev.push(['bar', t]); cur = []; };
    for (const tok of m.match(/\*[A-Za-z]|N[123]|[\[\]{}|Z]|[^\s\[\]{}|Z*]+/g) || []) {
      if (tok[0] === '*') { flush(); ev.push(['sec', tok[1]]); }
      else if (/^N[123]$/.test(tok)) { flush(); ev.push(['end', +tok[1]]); }
      else if (tok === '{') { flush(); ev.push(['rs']); }
      else if (tok === '}') { flush(); ev.push(['re']); }
      else if (tok === '[') { flush(); ev.push(['br']); }
      else if (tok === ']' || tok === '|' || tok === 'Z') flush();
      else cur.push(tok);
    }
    flush();
    // Wiederholungen und Schlüsse linear auflösen
    const lin = []; let sec = null, i = 0, start = null, pass = 1, inst = 0;
    while (i < ev.length) {
      const [k, v] = ev[i];
      if (k === 'rs') { start = i; inst++; }
      else if (k === 'br') inst++;
      else if (k === 'sec') { if (!(i > 0 && ['rs', 'br'].includes(ev[i - 1][0]))) inst++; sec = v; }
      else if (k === 'end' && v !== pass) { let j = i + 1; while (j < ev.length && !['end', 're'].includes(ev[j][0])) j++; if (j < ev.length && ev[j][0] === 're') j++; i = j; continue; }
      else if (k === 're' && pass === 1 && start != null) { pass = 2; i = start; continue; }
      else if (k === 'bar') lin.push({ sec, inst: inst + ':' + pass, txt: v });
      i++;
    }
    const bars = [];
    for (const b of lin) {
      const c = b.txt.split(/\s+/).map((t) => (t === 'x' ? '%' : t === 'n' ? 'N.C.' : t === 'r' ? 'R' : irealChord(t))).filter(Boolean).slice(0, 4);
      if (c[0] === 'R') { const a = bars[bars.length - 2], z = bars[bars.length - 1]; bars.push({ ...b, c: a ? [...a.c] : ['%'] }); bars.push({ ...b, c: z ? [...z.c] : ['%'] }); }
      else bars.push({ ...b, c });
    }
    const groups = [];
    for (const b of bars) { if (!groups.length || groups[groups.length - 1].sec !== b.sec || groups[groups.length - 1].inst !== b.inst) groups.push({ sec: b.sec, inst: b.inst, bars: [] }); groups[groups.length - 1].bars.push({ c: b.c }); }
    const LT = { i: 'intro', V: 'verse' };
    const sections = [], order = [];
    for (const g of groups) {
      const letter = g.sec || ''; const key = JSON.stringify(g.bars);
      let found = sections.find((x) => x._b === key);
      if (!found) {
        const same = sections.filter((x) => x._l === letter);
        let name = LT[letter] ? '' : letter || (g.bars.length === 12 ? 'Blues' : 'Form');
        if (same.length && !LT[letter]) { if (same[0].name === letter) same[0].name = letter + '1'; name = letter + (same.length + 1); }
        found = { id: (letter.toLowerCase() || 'f') + (sections.length + 1), type: LT[letter] || 'other', name, bars: g.bars, _b: key, _l: letter };
        sections.push(found);
      }
      const last = order[order.length - 1];
      if (last && last.s === found.id && last.x < 8) last.x++; else order.push({ s: found.id, x: 1 });
    }
    sections.forEach((x) => { delete x._b; delete x._l; });
    // Teile über 32 Takte in Stücke teilen (Server Grenze)
    const out = [];
    for (const sct of sections) {
      if (sct.bars.length <= 32) { out.push(sct); continue; }
      const parts = []; for (let k = 0; k < sct.bars.length; k += 32) parts.push({ ...sct, id: sct.id + 'p' + (k / 32 + 1), name: (sct.name || 'Teil') + ' ' + (k / 32 + 1), bars: sct.bars.slice(k, k + 32) });
      out.push(...parts);
      for (let k = order.length - 1; k >= 0; k--) if (order[k].s === sct.id) { const rep = order[k].x; order.splice(k, 1, ...Array.from({ length: rep }, () => parts.map((p) => ({ s: p.id, x: 1 }))).flat()); }
    }
    const idx = f.indexOf(music); const rest = f.slice(idx + 1);
    const bpm = Number(rest[1]) > 0 ? Number(rest[1]) : null;
    const key = (f[4] || '').replace('-', 'm');
    const style = (rest[0] || f[3] || '').replace(/^Jazz-/, '');
    return { title: f[0], composer: f[1], roadmap: { kind: 'roadmap', v: 1, sig, ...(bpm ? { bpm } : {}), ...(/^[A-G][#b]?m?$/.test(key) ? { key } : {}), ...(style ? { style: style.slice(0, 30) } : {}), sections: out, order } };
  }

  // Abspielen: Klick pro Schlag, Cursor pro Takt, Einzählen, Loop eines Ablauf Eintrags, Tempo üben
  // opts: { bpm, from (Takt Index), loop: order Index oder null, countIn: 0|1|2, feel: 'n'|'h'|'d'|null (null = wie im Chart),
  //         trainer: { add, max } (nach jedem Loop schneller), onBar(i, bar), onCount(n), onTempo(bpm), onEnd(), click(t, level), ctx }
  const PL = { playing: false };
  function play(rm, o) {
    stop();
    const bars = expand(rm); if (!bars.length) return;
    const bpb = beatsPerBar(rm.sig);
    const ctx = o.ctx; if (ctx.state === 'suspended') ctx.resume();
    let range = [0, bars.length - 1];
    if (o.loop != null) { const idx = bars.filter((b) => b.order === o.loop).map((b) => b.i); if (idx.length) range = [idx[0], idx[idx.length - 1]]; }
    Object.assign(PL, { playing: true, rm, bars, bpb, o, ctx, bpm: o.bpm || rm.bpm || 80, bar: Math.max(range[0], Math.min(o.from || range[0], range[1])), range, beat: -bpb * (o.countIn || 0), next: ctx.currentTime + 0.1, timers: [] });
    PL.timer = setInterval(tick, 25); tick();
  }
  function beatLevel(feel, b, bpb) {
    // Halftime: Klick auf 1 und 3 (Snare auf 3), Doubletime: Achtel; 6/8 und 12/8: Betonung auf den Gruppen
    if (bpb === 6 || bpb === 12) return b === 0 ? 2 : b % 3 === 0 ? 1.4 : 0.6;
    if (feel === 'h') return b === 0 ? 2 : b === 2 ? 1.4 : 0;
    return b === 0 ? 2 : 1;
  }
  function tick() {
    const P = PL; if (!P.playing) return;
    while (P.next < P.ctx.currentTime + 0.12) {
      const spb = 60 / P.bpm;
      if (P.beat < 0) { // Einzählen
        const n = P.bpb * (P.o.countIn || 0) + P.beat, b = n % P.bpb;
        P.o.click(P.next, b === 0 ? 2 : 1);
        const t = P.next; later(t, () => P.o.onCount && P.o.onCount(Math.floor(b) + 1));
        P.next += spb; P.beat++; continue;
      }
      const b = P.beat % P.bpb;
      if (b === 0) { const i = P.bar, bar = P.bars[i]; later(P.next, () => P.o.onBar && P.o.onBar(i, bar)); }
      const bar = P.bars[P.bar]; const feel = P.o.feel || bar.feel || 'n';
      const lvl = beatLevel(feel, b, P.bpb); if (lvl) P.o.click(P.next, lvl);
      if (feel === 'd' && P.bpb <= 4) P.o.click(P.next + spb / 2, 0.5);
      P.next += spb; P.beat++;
      if (P.beat % P.bpb === 0) {
        if (P.bar >= P.range[1]) {
          if (P.o.loop == null) { const t = P.next; later(t, () => { stop(); P.o.onEnd && P.o.onEnd(); }); P.playing = false; clearInterval(P.timer); return; }
          P.bar = P.range[0];
          if (P.o.trainer && P.bpm < P.o.trainer.max) { P.bpm = Math.min(P.o.trainer.max, P.bpm + P.o.trainer.add); const v = P.bpm; later(P.next, () => P.o.onTempo && P.o.onTempo(v)); }
        } else P.bar++;
      }
    }
  }
  function later(t, fn) { const ms = Math.max(0, (t - PL.ctx.currentTime) * 1000); PL.timers.push(setTimeout(fn, ms)); }
  function stop() { PL.playing = false; clearInterval(PL.timer); (PL.timers || []).forEach(clearTimeout); PL.timers = []; }
  function setTempo(b) { if (PL.playing) PL.bpm = b; }

  function fromIreal(link) {
    let body = String(link || '').trim();
    const m = /(irealb(?:ook)?:\/\/[^\s"'<>]+)/.exec(body); if (!m) return [];
    body = m[1].replace(/^irealb(?:ook)?:\/\//, '');
    try { body = decodeURIComponent(body); } catch (e) { return []; }
    const res = [];
    for (const part of body.split('===')) { const f = part.split('='); if (!f[0] || f.length < 6) continue; const s = irealSong(f); if (s) res.push(s); }
    return res;
  }

  const api = { play, stop, setTempo, isPlaying: () => PL.playing, current: () => PL.bar, fromIreal, TYPES, MARKS, FEELS, DYNS, transposeKey, transposeChord, nashville, capoOptions, shapeChord, useFlats, keyIndex, cheatSheet, expand, totalBars, duration, beatsPerBar, keyCycle, label, short, section, empty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Roadmap = api;
})(typeof window !== 'undefined' ? window : globalThis);
