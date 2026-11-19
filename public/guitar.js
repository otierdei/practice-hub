// Practice Hub Gitarren Modus: Akkordbilder, Schlagmuster, Tabs, Capo Helfer, Stimmgerät.
// Daten: { kind:'guitar', v:1, bpm, capo, key, chords:[name], strum:{ sub:8|16, bars, cells:['D'|'U'|'X'|''] }, tab:{ bars, notes:[[saite 0=tiefes E..5=hohes e, schritt (16tel), bund]] } }
'use strict';
(function () {
  // Standardgriffe, Bünde von tiefer E Saite bis hoher e Saite, -1 = nicht anschlagen
  const CHORDS = {
    'C': [-1, 3, 2, 0, 1, 0], 'Cadd9': [-1, 3, 2, 0, 3, 0], 'C/E': [0, 3, 2, 0, 1, 0], 'C/G': [3, 3, 2, 0, 1, 0],
    'D': [-1, -1, 0, 2, 3, 2], 'Dsus2': [-1, -1, 0, 2, 3, 0], 'Dsus4': [-1, -1, 0, 2, 3, 3], 'D/F#': [2, 0, 0, 2, 3, 2], 'Dm': [-1, -1, 0, 2, 3, 1],
    'E': [0, 2, 2, 1, 0, 0], 'Esus4': [0, 2, 2, 2, 0, 0], 'E7': [0, 2, 0, 1, 0, 0], 'Em': [0, 2, 2, 0, 0, 0], 'Em7': [0, 2, 2, 0, 3, 3],
    'F': [1, 3, 3, 2, 1, 1], 'Fmaj7': [-1, -1, 3, 2, 1, 0],
    'G': [3, 2, 0, 0, 0, 3], 'G (Worship)': [3, 2, 0, 0, 3, 3], 'G/B': [-1, 2, 0, 0, 3, 3],
    'A': [-1, 0, 2, 2, 2, 0], 'Asus2': [-1, 0, 2, 2, 0, 0], 'Asus4': [-1, 0, 2, 2, 3, 0], 'A7': [-1, 0, 2, 0, 2, 0], 'Am': [-1, 0, 2, 2, 1, 0], 'Am7': [-1, 0, 2, 0, 1, 0],
    'Bm': [-1, 2, 4, 4, 3, 2], 'B7': [-1, 2, 1, 2, 0, 2], 'Bb': [-1, 1, 3, 3, 3, 1],
  };
  const BARRE = { 'F': 1, 'Bm': 2, 'Bb': 1 };
  const GERMAN = { 'Bm': 'Hm', 'B7': 'H7', 'Bb': 'B' };
  const label = (c) => (GERMAN[c] ? `${c} (${GERMAN[c]})` : c);
  const OPEN = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
  const STRING_NAMES = ['E', 'A', 'D', 'G', 'H', 'e'];
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  const NOTES_INT = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function empty() { return { kind: 'guitar', v: 1, bpm: 80, capo: 0, key: '', chords: ['G', 'D', 'Em', 'C'], strum: { sub: 8, bars: 1, cells: ['', '', '', '', '', '', '', ''] }, tab: { bars: 1, notes: [] } }; }
  function parse(s) {
    if (!s) return null;
    try { const o = typeof s === 'string' ? JSON.parse(s) : s; if (o.kind !== 'guitar') return null; const e = empty(); const sc = o.scale && SC[o.scale.type] ? { root: ((Number(o.scale.root) || 0) % 12 + 12) % 12, type: o.scale.type, pos: Math.max(1, Number(o.scale.pos) || 1), ...(['e', 'a', '3nps'].includes(o.scale.sys) ? { sys: o.scale.sys } : {}) } : null; return { ...e, ...o, scale: sc, strum: { ...e.strum, ...(o.strum || {}) }, tab: { ...e.tab, ...(o.tab || {}) }, chords: o.chords || [] }; } catch (e) { return null; }
  }
  const strumLen = (g) => g.strum.sub * g.strum.bars;

  // ---------- Tonleitern ----------
  // Lage 1 beginnt auf dem Grundton der tiefen E Saite. Pentatoniken 2 Töne pro Saite (die 5 Boxen),
  // 7 tönige Tonleitern 3 Töne pro Saite, Blues = Moll Pentatonik Box plus blue note, Chromatisch = Fingerübung 1234.
  const SCALES = [
    ['pent_moll', 'Moll Pentatonik', [0, 3, 5, 7, 10]],
    ['pent_dur', 'Dur Pentatonik', [0, 2, 4, 7, 9]],
    ['blues', 'Blues Tonleiter', [0, 3, 5, 6, 7, 10]],
    ['dur', 'Dur (Ionisch)', [0, 2, 4, 5, 7, 9, 11]],
    ['moll', 'Moll (Äolisch)', [0, 2, 3, 5, 7, 8, 10]],
    ['harm_moll', 'Harmonisch Moll', [0, 2, 3, 5, 7, 8, 11]],
    ['dorisch', 'Dorisch', [0, 2, 3, 5, 7, 9, 10]],
    ['mixo', 'Mixolydisch', [0, 2, 4, 5, 7, 9, 10]],
    ['phryg', 'Phrygisch', [0, 1, 3, 5, 7, 8, 10]],
    ['lyd', 'Lydisch', [0, 2, 4, 6, 7, 9, 11]],
    ['chrom', 'Chromatisch (Fingerübung 1234)', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ];
  const SC = Object.fromEntries(SCALES.map(([k, n, iv]) => [k, { k, n, iv }]));
  const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
  const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'B', 'H']; // deutsch: B = Bb, H = B
  const pcName = (pc) => ROOTS[((pc % 12) + 12) % 12];
  // Fingersatz für 7 tönige Tonleitern: Box wie bei Norbert (ein Finger pro Bund, Grundton auf E oder A Saite) oder 3 Töne pro Saite
  const SYS = [['e', 'Box, Grundton E Saite'], ['a', 'Box, Grundton A Saite'], ['3nps', '3 Töne pro Saite']];
  const isSeven = (sc) => { const t = SC[sc && sc.type]; return !!t && t.iv.length === 7; };
  const sysOf = (sc) => (isSeven(sc) ? (['e', 'a', '3nps'].includes(sc.sys) ? sc.sys : 'e') : '');
  // Kennton der Tonleiter (bei Norbert rot): Dorisch große Sexte, Mixolydisch kleine Septime usw.
  const KENN = { dorisch: 9, mixo: 10, lyd: 6, phryg: 1, harm_moll: 11 };
  function scalePositions(sc) { const t = SC[sc && sc.type]; if (!t) return 0; if (sysOf(sc) === 'e' || sysOf(sc) === 'a') return 1; return t.k === 'chrom' ? 12 : t.k === 'blues' ? 5 : t.iv.length; }
  // Box: Start eine Stufe unter dem Grundton bei Dur Charakter (Grundton = Finger 2), sonst Grundton = Finger 1.
  // Töne aufsteigend; passt ein Ton nicht mehr in die 4 Bünde, geht es auf die nächste Saite.
  // Wäre er dort unter der Box, rutscht die Hand bei Dur nach oben (Finger 4 streckt), sonst nach unten (Finger 1 streckt).
  function boxPattern(t, root, sys) {
    const major = t.iv.includes(4), str0 = sys === 'a' ? 1 : 0;
    let r = (root - (sys === 'a' ? 9 : 4) + 12) % 12; if (r === 0) r = 12;
    const start = major ? r - 1 : r, end = start + 3;
    const inS = (m) => t.iv.includes(((m - root) % 12 + 12) % 12);
    let m = OPEN_MIDI[0] + start; while (!inS(m)) m++;
    const out = []; let s = 0;
    for (; m <= OPEN_MIDI[5] + end + 1; m++) {
      if (!inS(m)) continue;
      let f = m - OPEN_MIDI[s];
      if (f > end) {
        const f2 = s < 5 ? m - OPEN_MIDI[s + 1] : null;
        if (f2 === null) { if (f === end + 1) out.push({ s, f, shift: true }); break; }
        if (f2 >= start) { s++; f = f2; }
        else if (f2 === start - 1 && !major) { s++; f = f2; }
        else if (f === end + 1) { out.push({ s, f, shift: true }); continue; }
        else { s++; f = f2; }
      }
      out.push({ s, f, shift: f < start || f > end });
    }
    void str0; return { notes: out, start };
  }
  function scalePattern(sc) {
    const t = SC[sc && sc.type]; if (!t) return [];
    const root = ((Number(sc.root) || 0) % 12 + 12) % 12, pos = Math.max(1, Math.min(scalePositions(sc), Number(sc.pos) || 1));
    let notes = [];
    if (t.k === 'chrom') { for (let s = 0; s < 6; s++) for (let f = pos; f < pos + 4; f++) notes.push({ s, f }); }
    else if (sysOf(sc) === 'e' || sysOf(sc) === 'a') notes = boxPattern(t, root, sysOf(sc)).notes;
    else {
      const path = t.k === 'blues' ? SC.pent_moll.iv : t.iv, nps = path.length === 5 ? 2 : 3;
      let start = (root - 4 + 12) % 12 + path[(pos - 1) % path.length]; if (start > 12) start -= 12;
      const inPath = (m) => path.includes(((m - root) % 12 + 12) % 12);
      let s = 0, n = 0, m = OPEN_MIDI[0] + start;
      while (s < 6) { if (inPath(m)) { if (n === nps) { s++; n = 0; if (s > 5) break; } notes.push({ s, f: m - OPEN_MIDI[s] }); n++; } m++; }
      if (t.k === 'blues') {
        for (let st = 0; st < 6; st++) { const fs = notes.filter((x) => x.s === st).map((x) => x.f); const lo = Math.min(...fs) - 1, hi = Math.max(...fs) + 1;
          for (let f = Math.max(0, lo); f <= hi; f++) if (((OPEN_MIDI[st] + f - root) % 12 + 12) % 12 === 6) notes.push({ s: st, f }); }
      }
      if (notes.some((x) => x.f < 0)) notes = notes.map((x) => ({ s: x.s, f: x.f + 12 }));
      if (notes.every((x) => x.f >= 12)) notes = notes.map((x) => ({ s: x.s, f: x.f - 12 }));
    }
    return notes.map((x) => { const pc = ((OPEN_MIDI[x.s] + x.f - root) % 12 + 12) % 12; return { ...x, m: OPEN_MIDI[x.s] + x.f, pc: (OPEN_MIDI[x.s] + x.f) % 12, root: pc === 0 && t.k !== 'chrom', blue: (t.k === 'blues' && pc === 6) || KENN[t.k] === pc }; })
      .sort((a, b) => a.m - b.m || a.s - b.s);
  }
  // Reihenfolge zum Üben: hoch und wieder runter
  function scaleOrder(sc) { const n = scalePattern(sc).length; const up = Array.from({ length: n }, (_, i) => i); return n < 2 ? up : up.concat(up.slice(1, -1).reverse()); }
  function scaleName(sc) { const t = SC[sc && sc.type]; if (!t) return ''; if (t.k === 'chrom') return `${t.n}, ab Bund ${sc.pos || 1}`; const sy = sysOf(sc); return `${pcName(sc.root)} ${t.n}, ${sy === 'e' || sy === 'a' ? SYS.find((x) => x[0] === sy)[1] : 'Lage ' + (sc.pos || 1)}`; }
  function scaleTones(sc) { const t = SC[sc && sc.type]; if (!t || t.k === 'chrom') return ''; return t.iv.map((i) => pcName((Number(sc.root) || 0) + i)).join(' '); }
  function scaleSVG(sc, opt = {}) {
    const notes = scalePattern(sc); if (!notes.length) return '';
    const fs = notes.map((x) => x.f), minF = Math.min(...fs), maxF = Math.max(...fs);
    const lo = minF === 0 ? 1 : minF, hi = Math.max(lo + 3, maxF), fw = 46, x0 = 44, W = x0 + (hi - lo + 1) * fw + 12, H = 150, ink = 'currentColor', out = [];
    const yS = (s) => 18 + (5 - s) * 20; // hohe e Saite oben, wie in den Tabs
    const xF = (f) => (f === 0 ? x0 - 16 : x0 + (f - lo + 0.5) * fw);
    for (let s = 0; s < 6; s++) out.push(`<line x1="${x0}" x2="${W - 12}" y1="${yS(s)}" y2="${yS(s)}" stroke="${ink}" opacity=".55" stroke-width="${1 + (5 - s) * 0.0 + (s < 3 ? 0.6 : 0)}"/><text x="6" y="${yS(s) + 4}" font-size="11" fill="${ink}" opacity=".7">${STRING_NAMES[s]}</text>`);
    for (let f = lo - 1; f <= hi; f++) { const x = x0 + (f - lo + 1) * fw; out.push(`<line x1="${x}" x2="${x}" y1="${yS(5)}" y2="${yS(0)}" stroke="${ink}" stroke-width="${f === 0 ? 4 : 1.2}" opacity="${f === 0 ? 1 : 0.6}"/>`); }
    for (let f = lo; f <= hi; f++) { out.push(`<text x="${xF(f)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="${ink}" opacity=".75">${f}</text>`); if ([3, 5, 7, 9, 15, 17].includes(f)) out.push(`<circle cx="${xF(f)}" cy="${H - 30}" r="3" fill="${ink}" opacity=".35"/>`); if (f === 12) out.push(`<circle cx="${xF(f) - 6}" cy="${H - 30}" r="3" fill="${ink}" opacity=".35"/><circle cx="${xF(f) + 6}" cy="${H - 30}" r="3" fill="${ink}" opacity=".35"/>`); }
    if (sysOf(sc) === 'e' || sysOf(sc) === 'a') { const st = boxPattern(SC[sc.type], ((Number(sc.root) || 0) % 12 + 12) % 12, sysOf(sc)).start; for (let k = 0; k < 4; k++) if (st + k >= lo && st + k <= hi) out.push(`<text x="${xF(st + k)}" y="9" text-anchor="middle" font-size="10" font-weight="700" fill="${ink}" opacity=".8">${k + 1}</text>`); }
    notes.forEach((x, i) => {
      const cx = xF(x.f), cy = yS(x.s), fill = x.root ? 'var(--accent, #4f5a2c)' : x.blue ? 'var(--ring2, #8a6236)' : ink, txt = x.root || x.blue ? 'var(--accent-ink, #fff)' : 'var(--sunk, #fff)';
      const label = SC[sc.type].k === 'chrom' ? String(x.f - (Number(sc.pos) || 1) + 1) : pcName(x.pc);
      out.push(`<g class="gt-sdot" data-n="${i}"><circle cx="${cx}" cy="${cy}" r="9.5" fill="${fill}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${label.length > 1 ? 8.5 : 10}" font-weight="700" fill="${txt}">${esc(label)}</text></g>`);
    });
    return `<svg class="gt-scale" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Griffbrett: ${esc(scaleName(sc))}">${out.join('')}</svg>`;
  }
  function scaleCursor(svg, sc) { const ord = scaleOrder(sc); return (i) => { if (!svg) return; svg.querySelectorAll('.gt-sdot.on').forEach((e) => e.classList.remove('on')); if (i < 0) return; const el = svg.querySelector(`[data-n="${ord[i % ord.length]}"]`); if (el) el.classList.add('on'); }; }
  // Tonleiter als Tabs (Achtel, hoch und runter)
  function scaleToTab(g) {
    const notes = scalePattern(g.scale), ord = scaleOrder(g.scale); if (!notes.length) return;
    const steps = Math.min(ord.length, 64), bars = Math.min(8, Math.ceil((steps * 2) / 16));
    g.tab = { bars, notes: ord.slice(0, bars * 8).map((n, k) => [notes[n].s, k * 2, notes[n].f]) };
  }
  function scaleBlock(g, id, edit) {
    const sc = g.scale; if (!sc) return '';
    return `<div class="gt-scalebox"><p><b>${esc(scaleName(sc))}</b>${scaleTones(sc) ? `<br><span class="small muted">Töne: ${esc(scaleTones(sc))}</span>` : ''}</p>
      <div class="gt-scalewrap">${scaleSVG(sc)}</div>
      <p class="small muted">${SC[sc.type].k === 'chrom' ? 'Zahl im Kreis = Finger. Pro Saite 1 2 3 4, dann die nächste Saite.' : 'Grün = Grundton' + (SC[sc.type].k === 'blues' ? ', braun = blue note' : KENN[SC[sc.type].k] != null ? ', braun = Kennton (' + ({ 9: 'große Sexte', 10: 'kleine Septime', 6: 'übermäßige Quarte', 1: 'kleine Sekunde', 11: 'große Septime' })[KENN[SC[sc.type].k]] + ')' : '') + '. ' + (sysOf(sc) === 'e' || sysOf(sc) === 'a' ? 'Zahlen oben = Finger, ein Finger pro Bund. Töne außerhalb: Hand kurz verschieben. ' : '') + 'Hoch und wieder runter spielen, Wechselschlag.'}</p>
      ${edit ? '' : ''}</div>`;
  }

  // ---------- Akkordbild ----------
  function chordSVG(name, size = 1) {
    const f = CHORDS[name]; if (!f) return `<div class="gt-chord"><b>${esc(name)}</b><span class="small muted">eigener Akkord</span></div>`;
    const played = f.filter((x) => x > 0), base = Math.max(...played, 0) > 4 ? Math.min(...played) : 1;
    const W = 96 * size, H = 116 * size, sx = 14 * size, sp = 13.6 * size, top = 30 * size, fh = 16 * size, ink = 'currentColor', out = [];
    for (let s = 0; s < 6; s++) out.push(`<line x1="${sx + s * sp}" x2="${sx + s * sp}" y1="${top}" y2="${top + 5 * fh}" stroke="${ink}" stroke-width="1"/>`);
    for (let r = 0; r <= 5; r++) out.push(`<line x1="${sx}" x2="${sx + 5 * sp}" y1="${top + r * fh}" y2="${top + r * fh}" stroke="${ink}" stroke-width="${r === 0 && base === 1 ? 4 : 1}"/>`);
    if (base > 1) out.push(`<text x="${sx + 5 * sp + 6}" y="${top + fh * 0.7}" font-size="${10 * size}" fill="${ink}">${base}</text>`);
    if (BARRE[name]) { const fr = BARRE[name] - base + 1; out.push(`<rect x="${sx - 4}" y="${top + (fr - 0.5) * fh - 5}" width="${5 * sp + 8}" height="10" rx="5" fill="${ink}"/>`); }
    f.forEach((v, s) => {
      const x = sx + s * sp;
      if (v < 0) out.push(`<path d="M${x - 4} ${top - 14} l8 8 m0 -8 l-8 8" stroke="${ink}" stroke-width="1.6"/>`);
      else if (v === 0) out.push(`<circle cx="${x}" cy="${top - 10}" r="4" fill="none" stroke="${ink}" stroke-width="1.4"/>`);
      else if (!(BARRE[name] && v === BARRE[name])) out.push(`<circle cx="${x}" cy="${top + (v - base + 0.5) * fh}" r="${5.4 * size}" fill="${ink}"/>`);
    });
    return `<figure class="gt-chord"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Akkord ${esc(label(name))}">${out.join('')}</svg><figcaption>${esc(label(name))}</figcaption></figure>`;
  }

  // ---------- Schlagmuster ----------
  function strumCountLabel(sub, i) { const j = i % sub; if (sub === 8) return j % 2 ? '+' : String(j / 2 + 1); return [String(Math.floor(j / 4) + 1), 'e', '+', 'a'][j % 4]; }
  function strumSVG(g, opt = {}) {
    const n = strumLen(g), cw = g.strum.sub === 8 ? 34 : 24, W = n * cw + 20, H = 74, ink = 'currentColor', out = [];
    g.strum.cells.forEach((c, i) => {
      const x = 10 + i * cw + cw / 2;
      if (i && i % g.strum.sub === 0) out.push(`<line x1="${10 + i * cw}" x2="${10 + i * cw}" y1="6" y2="56" stroke="${ink}" opacity=".35"/>`);
      if (c === 'D') out.push(`<path d="M${x} 10 v32 m-7 -9 l7 9 l7 -9" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (c === 'U') out.push(`<path d="M${x} 44 v-32 m-7 9 l7 -9 l7 9" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (c === 'X') out.push(`<path d="M${x - 7} 20 l14 14 m0 -14 l-14 14" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`);
      if (!c) out.push(`<circle cx="${x}" cy="27" r="2" fill="${ink}" opacity=".35"/>`);
      out.push(`<text x="${x}" y="68" text-anchor="middle" font-size="11" fill="${ink}" opacity="${i % (g.strum.sub / 4) === 0 ? 1 : 0.55}">${strumCountLabel(g.strum.sub, i)}</text>`);
    });
    if (opt.cursor) out.push(`<rect class="gt-cursor" x="0" y="2" width="${cw}" height="58" rx="6" fill="var(--ring, #5f6b3a)" opacity="0"/>`);
    return `<svg class="gt-strum" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Schlagmuster" data-cw="${cw}">${out.join('')}</svg>`;
  }

  // ---------- Tabs ----------
  function tabSVG(g, opt = {}) {
    const steps = g.tab.bars * 16, cw = 22, W = 44 + steps * cw + 10, H = 120, ink = 'currentColor', out = [];
    const yS = (s) => 18 + (5 - s) * 16; // hohe e Saite oben
    for (let s = 0; s < 6; s++) out.push(`<line x1="28" x2="${W - 6}" y1="${yS(s)}" y2="${yS(s)}" stroke="${ink}" opacity=".5"/><text x="10" y="${yS(s) + 4}" font-size="10" fill="${ink}" opacity=".7">${STRING_NAMES[s]}</text>`);
    for (let b = 1; b <= g.tab.bars; b++) { const x = 44 + b * 16 * cw - 4; out.push(`<line x1="${x}" x2="${x}" y1="${yS(5)}" y2="${yS(0)}" stroke="${ink}" stroke-width="${b === g.tab.bars ? 2.5 : 1}"/>`); }
    for (const [s, step, fret] of g.tab.notes) {
      const x = 44 + step * cw + cw / 2 - 4;
      out.push(`<rect x="${x - 8}" y="${yS(s) - 8}" width="16" height="16" fill="var(--sunk, #fff)"/><text x="${x}" y="${yS(s) + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${ink}">${fret}</text>`);
    }
    if (opt.cursor) out.push(`<rect class="gt-cursor" x="0" y="6" width="${cw}" height="${H - 18}" rx="5" fill="var(--ring, #5f6b3a)" opacity="0"/>`);
    return `<svg class="gt-tab" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Tabulatur" data-x0="44" data-cw="${cw}">${out.join('')}</svg>`;
  }

  // ---------- Klang ----------
  let ctx = null;
  function audio() { ctx = ctx || (window.__phAudio = window.__phAudio || new (window.AudioContext || window.webkitAudioContext)()); if (ctx.state === 'suspended') ctx.resume(); loadSamples(); return ctx; }
  // Echte Akustikgitarre (Otis Wunsch 18.11.2026): 12 Samples, dazwischen per Tonhöhe verschoben. Bis sie geladen sind, klingt der Synthesizer.
  const SAMPLES = [['E2', 40], ['G2', 43], ['As2', 46], ['Cs3', 49], ['E3', 52], ['G3', 55], ['As3', 58], ['Cs4', 61], ['E4', 64], ['G4', 67], ['As4', 70], ['Cs5', 73]];
  const BUF = {}; let loading = false;
  function loadSamples() {
    if (loading || !ctx) return; loading = true;
    for (const [n, m] of SAMPLES) fetch('samples/gtr/' + n + '.mp3?v=1').then((r) => r.arrayBuffer()).then((b) => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no))).then((buf) => { BUF[m] = buf; }).catch(() => {});
  }
  function pluck(freq, t, dur = 1.2, peak = 0.18) {
    const midi = 69 + 12 * Math.log2(freq / 440), near = SAMPLES.map((x) => x[1]).filter((m) => BUF[m]).sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi))[0];
    if (near != null) {
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = BUF[near]; src.playbackRate.value = Math.pow(2, (midi - near) / 12);
      const len = Math.min(dur + 0.4, 1.8); g.gain.setValueAtTime(peak * 4, t); g.gain.setTargetAtTime(0.0001, t + len - 0.25, 0.08);
      src.connect(g).connect(ctx.destination); src.start(t); src.stop(t + len); return;
    }
    synthPluck(freq, t, dur, peak);
  }
  function click(t, strong) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = strong ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(strong ? 0.35 : 0.22, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }
  function synthPluck(freq, t, dur = 1.2, peak = 0.18) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = freq; o2.frequency.value = freq * 2;
    f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 8, t); f.frequency.exponentialRampToValueAtTime(freq * 2, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.15;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(g2).connect(f); f.connect(g).connect(ctx.destination);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  const fretFreq = (s, fret, capo) => OPEN[s] * Math.pow(2, (fret + capo) / 12);
  function strum(name, dir, t, capo) {
    const f = CHORDS[name] || CHORDS.G;
    if (dir === 'X') { const b = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 0.4; s.buffer = b; s.connect(g).connect(ctx.destination); s.start(t); return; }
    const order = dir === 'U' ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
    let k = 0;
    for (const s of order) { if (f[s] < 0 || (dir === 'U' && s < 2)) continue; pluck(fretFreq(s, f[s], capo), t + k * 0.012, dir === 'U' ? 0.6 : 1.0, dir === 'U' ? 0.11 : 0.16); k++; }
  }

  // Wiedergabe: Schlagmuster über die Akkordfolge (ein Durchlauf des Musters pro Akkord) oder Tabs
  const P = { playing: false, timer: null, next: 0, step: 0, g: null, mode: 'strum', bpm: 80, queue: [], onStep: null, onChord: null };
  // Mitspielen: opt.countIn Schläge Einzählen, opt.click Metronom auf jedem Schlag, läuft in Schleife bis Stopp
  function play(g, mode, bpm, onStep, onChord, opt = {}) {
    stop(); audio();
    Object.assign(P, { g, mode, bpm: bpm || g.bpm, onStep, onChord, playing: true, step: 0, queue: [], click: !!opt.click, onCount: opt.onCount || null });
    if (mode === 'scale') { P.sNotes = scalePattern(g.scale); P.sOrd = scaleOrder(g.scale); if (!P.sNotes.length) { P.playing = false; return; } }
    P.next = ctx.currentTime + 0.08;
    const n = Math.max(0, opt.countIn | 0), beat = 60 / P.bpm;
    for (let k = 0; k < n; k++) { click(P.next, k === 0); P.queue.push({ t: P.next, i: -2 - (n - k), chord: null }); P.next += beat; }
    P.timer = setInterval(schedule, 25); requestAnimationFrame(draw);
  }
  const stepsPerBeat = () => (P.mode === 'tab' ? 4 : P.mode === 'scale' ? 2 : (P.g.strum.sub || 8) / 4);
  function stop() { P.playing = false; clearInterval(P.timer); P.timer = null; if (P.onStep) P.onStep(-1); }
  function setTempo(b) { P.bpm = b; }
  function schedule() {
    const g = P.g;
    while (P.next < ctx.currentTime + 0.12) {
      let i, dur, chord = null;
      if (P.mode === 'strum') {
        const n = strumLen(g); i = P.step % n;
        const chords = g.chords.length ? g.chords : ['G'];
        chord = chords[Math.floor(P.step / n) % chords.length];
        const c = g.strum.cells[i]; if (c) strum(chord, c, P.next, g.capo || 0);
        dur = 60 / P.bpm / (g.strum.sub / 4);
      } else if (P.mode === 'scale') {
        i = P.step % P.sOrd.length; const x = P.sNotes[P.sOrd[i]];
        pluck(fretFreq(x.s, x.f, 0), P.next, 0.8, 0.2); dur = 60 / P.bpm / 2;
      } else {
        const n = g.tab.bars * 16; i = P.step % n;
        for (const [s, step, fret] of g.tab.notes) if (step === i) pluck(fretFreq(s, fret, g.capo || 0), P.next, 0.9, 0.2);
        dur = 60 / P.bpm / 4;
      }
      if (P.click && P.step % stepsPerBeat() === 0) click(P.next, (P.step / stepsPerBeat()) % 4 === 0);
      P.queue.push({ t: P.next, i, chord }); P.next += dur; P.step++;
    }
  }
  function draw() {
    if (!P.playing) return;
    let cur = null; while (P.queue.length && P.queue[0].t <= ctx.currentTime) cur = P.queue.shift();
    if (cur) { if (cur.i <= -2) { if (P.onCount) P.onCount(-1 - cur.i - 1); } else { if (P.onStep) P.onStep(cur.i); if (cur.chord && P.onChord) P.onChord(cur.chord); } }
    requestAnimationFrame(draw);
  }
  function cursorFor(svg, x0Attr) {
    return (i) => {
      if (!svg || !svg.isConnected) return;
      const c = svg.querySelector('.gt-cursor'); if (!c) return;
      if (i < 0) { c.setAttribute('opacity', '0'); return; }
      const cw = Number(svg.dataset.cw), x0 = Number(svg.dataset.x0 || 10);
      c.setAttribute('x', x0 + i * cw - (svg.dataset.x0 ? 4 : 0)); c.setAttribute('opacity', '.2');
    };
  }

  // ---------- Capo Helfer ----------
  // Für eine klingende Tonart: welcher Bund mit welcher Griffform
  function capoTable(key) {
    const k = NOTES_INT.indexOf(key) >= 0 ? NOTES_INT.indexOf(key) : NOTES.indexOf(key);
    if (k < 0) return [];
    return ['G', 'C', 'D', 'A', 'E'].map((shape) => { const capo = (k - NOTES_INT.indexOf(shape) + 12) % 12; return { shape, capo }; }).filter((x) => x.capo <= 7).sort((a, b) => a.capo - b.capo);
  }
  function soundingKey(shape, capo) { const k = NOTES_INT.indexOf(shape); return k < 0 ? '' : NOTES_INT[(k + capo) % 12]; }

  // ---------- Stimmgerät ----------
  const T = { stream: null, raf: 0, analyser: null, buf: null, last: 0, hist: [] };
  // Tonhöhe mit YIN auf halber Abtastrate, nur Lags für 60 bis 1200 Hz (19.11.2026: vorher Autokorrelation über den ganzen Puffer,
  // rund zehnmal langsamer und in jedem Bild gerechnet, dadurch reagierte das Stimmgerät am iPhone sehr träge)
  const Y = { ds: null, d: null };
  function autoCorrelate(buf, rate) {
    let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / buf.length); if (rms < 0.008) return -1;
    const n = buf.length >> 1, sr = rate / 2;
    if (!Y.ds || Y.ds.length !== n) Y.ds = new Float32Array(n);
    const x = Y.ds; for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
    const minLag = Math.max(2, Math.floor(sr / 1200)), maxLag = Math.min(Math.floor(sr / 60), n >> 1), W = n - maxLag - 1;
    if (!Y.d || Y.d.length !== maxLag + 2) Y.d = new Float32Array(maxLag + 2);
    const d = Y.d; d[0] = 1; let run = 0;
    for (let t = 1; t <= maxLag + 1; t++) { let s = 0; for (let j = 0; j < W; j++) { const v = x[j] - x[j + t]; s += v * v; } run += s; d[t] = run ? (s * t) / run : 1; }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) if (d[t] < 0.15) { while (t + 1 <= maxLag && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 0) { let best = 1; for (let t = minLag; t <= maxLag; t++) if (d[t] < best) { best = d[t]; tau = t; } if (best > 0.35) return -1; }
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b;
    return sr / (den ? tau + (a - c) / (2 * den) : tau);
  }
  function noteOf(freq) {
    const n = 12 * Math.log2(freq / 440) + 69, r = Math.round(n);
    return { name: NOTES[(r % 12 + 12) % 12], octave: Math.floor(r / 12) - 1, cents: Math.round((n - r) * 100) };
  }
  async function tunerStart(onReading) {
    audio();
    T.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = ctx.createMediaStreamSource(T.stream); T.analyser = ctx.createAnalyser(); T.analyser.fftSize = 2048; src.connect(T.analyser);
    T.buf = new Float32Array(T.analyser.fftSize);
    T.hist = []; T.last = 0;
    const loop = (now) => {
      T.raf = requestAnimationFrame(loop);
      if (now - T.last < 30) return; // höchstens etwa 30 Messungen pro Sekunde, Rest der Zeit bleibt für die Anzeige
      T.last = now;
      T.analyser.getFloatTimeDomainData(T.buf);
      const f = autoCorrelate(T.buf, ctx.sampleRate);
      if (!(f > 60 && f < 1200)) { if (T.hist.length && now - T.hist[T.hist.length - 1].t > 400) T.hist = []; return; }
      // Median der letzten Messungen gegen Ausreißer (Oktavsprünge beim Anschlag); neuer Ton setzt sofort neu an
      if (T.hist.length && Math.abs(Math.log2(f / T.hist[T.hist.length - 1].f)) > 0.08) T.hist = [];
      T.hist.push({ f, t: now }); if (T.hist.length > 5) T.hist.shift();
      const m = T.hist.map((h) => h.f).sort((x, y) => x - y)[T.hist.length >> 1];
      const nearest = OPEN.reduce((best, o, s) => (Math.abs(Math.log2(m / o)) < Math.abs(Math.log2(m / OPEN[best])) ? s : best), 0);
      onReading({ freq: m, ...noteOf(m), string: nearest });
    };
    T.raf = requestAnimationFrame(loop);
  }
  function tunerStop() { cancelAnimationFrame(T.raf); if (T.stream) T.stream.getTracks().forEach((t) => t.stop()); T.stream = null; }
  function tunerHTML() {
    return `<div class="gt-tuner" id="tuner">
      <div class="gt-tuner-note" aria-live="polite"><b id="tunerNote">–</b><span id="tunerCents" class="muted">Spiel eine leere Saite</span></div>
      <svg viewBox="0 0 240 70" width="100%" height="70" role="img" aria-label="Abweichung in Cent"><line x1="20" x2="220" y1="40" y2="40" stroke="currentColor" opacity=".3"/><line x1="120" x2="120" y1="22" y2="58" stroke="currentColor" stroke-width="2"/><circle id="tunerDot" cx="120" cy="40" r="9" fill="var(--ring, #5f6b3a)"/><text x="20" y="66" font-size="10" fill="currentColor" opacity=".6">tiefer</text><text x="220" y="66" text-anchor="end" font-size="10" fill="currentColor" opacity=".6">höher</text></svg>
      <div class="row" style="justify-content:space-between">${STRING_NAMES.map((n, s) => `<span class="gt-string" data-s="${s}">${n}</span>`).join('')}</div>
    </div>`;
  }

  // ---------- Editor ----------
  function editorHTML(g, id, sel) {
    const chordOpts = Object.keys(CHORDS).map((c) => `<option value="${esc(c)}">${esc(label(c))}</option>`).join('');
    const sCells = g.strum.cells.map((c, i) => `<button type="button" class="gt-scell" data-gt="${id}" data-gt-s="${i}" aria-label="Schlag ${i + 1}: ${c === 'D' ? 'ab' : c === 'U' ? 'auf' : c === 'X' ? 'gedämpft' : 'Pause'}">${c === 'D' ? '↓' : c === 'U' ? '↑' : c === 'X' ? '×' : '·'}</button>`).join('');
    const tSteps = g.tab.bars * 16;
    const tRows = [5, 4, 3, 2, 1, 0].map((s) => `<tr><th scope="row">${STRING_NAMES[s]}</th>${Array.from({ length: tSteps }, (_, i) => {
      const note = g.tab.notes.find((x) => x[0] === s && x[1] === i); const isSel = sel && sel[0] === s && sel[1] === i;
      return `<td class="${Math.floor(i / 4) % 2 ? 'nt-alt' : ''}"><button type="button" class="gt-tcell" data-gt="${id}" data-gt-t="${s},${i}" aria-pressed="${isSel}" aria-label="Saite ${STRING_NAMES[s]}, Schritt ${i + 1}${note ? ', Bund ' + note[2] : ''}">${note ? note[2] : ''}</button></td>`;
    }).join('')}</tr>`).join('');
    return `<div class="gt-editor" id="${id}">
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-capo">Capo</label><select id="${id}-capo" data-gt-ctl="capo">${Array.from({ length: 10 }, (_, i) => `<option value="${i}" ${g.capo === i ? 'selected' : ''}>${i ? 'Bund ' + i : 'ohne'}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-bpm">Tempo</label><input id="${id}-bpm" data-gt-ctl="bpm" inputmode="numeric" value="${g.bpm}"></div>
      </div>
      <h4 class="gt-h">Akkorde</h4>
      <div class="gt-chords">${g.chords.map((c, i) => `<div class="gt-chordwrap">${chordSVG(c)}<button type="button" class="btn small" data-gt-act="rmChord" data-gt-id="${id}" data-i="${i}" aria-label="${esc(label(c))} entfernen">Entfernen</button></div>`).join('') || '<p class="muted small">Noch keine Akkorde.</p>'}</div>
      <div class="row" style="flex-wrap:nowrap"><label for="${id}-add" class="nt-sr">Akkord hinzufügen</label><select id="${id}-add">${chordOpts}</select><button type="button" class="btn small" data-gt-act="addChord" data-gt-id="${id}">Hinzufügen</button></div>
      ${g.capo ? `<p class="small muted">Mit Capo im ${g.capo}. Bund klingt G als ${soundingKey('G', g.capo)}, C als ${soundingKey('C', g.capo)}, D als ${soundingKey('D', g.capo)}.</p>` : ''}
      <h4 class="gt-h">Schlagmuster <span class="small muted">(optional)</span></h4>
      ${!g.strum.cells.some(Boolean) && !g.strumOpen ? `<button type="button" class="btn small" data-gt-act="strumOn" data-gt-id="${id}">Schlagmuster hinzufügen</button>` : `
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-sub">Raster</label><select id="${id}-sub" data-gt-ctl="sub"><option value="8" ${g.strum.sub === 8 ? 'selected' : ''}>8tel</option><option value="16" ${g.strum.sub === 16 ? 'selected' : ''}>16tel</option></select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-sbars">Takte</label><select id="${id}-sbars" data-gt-ctl="sbars">${[1, 2].map((b) => `<option ${g.strum.bars === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      </div>
      <div class="gt-strumwrap">${strumSVG(g, { cursor: true })}</div>
      <div class="gt-scells">${sCells}</div>
      <p class="small muted">Tippen wechselt: Pause, ab, auf, gedämpft.</p>
      <div class="row" style="gap:8px"><button type="button" class="btn small primary" data-gt-act="playStrum" data-gt-id="${id}">Schlagmuster mit Akkorden abspielen</button><button type="button" class="btn small" data-gt-act="strumOff" data-gt-id="${id}">Schlagmuster entfernen</button></div>`}
      <h4 class="gt-h">Tonleiter <span class="small muted">(optional)</span></h4>
      ${!g.scale ? `<button type="button" class="btn small" data-gt-act="scaleOn" data-gt-id="${id}">Tonleiter hinzufügen</button>` : `
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;min-width:110px"><label for="${id}-stype">Tonleiter</label><select id="${id}-stype" data-gt-ctl="stype">${SCALES.map(([k, n]) => `<option value="${k}" ${g.scale.type === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        ${g.scale.type === 'chrom' ? '' : `<div class="field" style="flex:1;min-width:80px"><label for="${id}-sroot">Grundton</label><select id="${id}-sroot" data-gt-ctl="sroot">${ROOTS.map((r, i) => `<option value="${i}" ${Number(g.scale.root) === i ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`}
        ${isSeven(g.scale) ? `<div class="field" style="flex:1;min-width:140px"><label for="${id}-ssys">Fingersatz</label><select id="${id}-ssys" data-gt-ctl="ssys">${SYS.map(([k, n]) => `<option value="${k}" ${sysOf(g.scale) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
        ${scalePositions(g.scale) > 1 ? `<div class="field" style="flex:1;min-width:80px"><label for="${id}-spos">${g.scale.type === 'chrom' ? 'Ab Bund' : 'Lage'}</label><select id="${id}-spos" data-gt-ctl="spos">${Array.from({ length: scalePositions(g.scale) }, (_, i) => `<option value="${i + 1}" ${Number(g.scale.pos) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>` : ''}
      </div>
      ${scaleBlock(g, id, true)}
      <div class="row" style="gap:8px"><button type="button" class="btn small primary" data-gt-act="playScale" data-gt-id="${id}">Tonleiter abspielen</button><button type="button" class="btn small" data-gt-act="scaleTab" data-gt-id="${id}">Als Tabs übernehmen</button><button type="button" class="btn small" data-gt-act="scaleOff" data-gt-id="${id}">Tonleiter entfernen</button></div>`}
      <h4 class="gt-h">Tabs</h4>
      <div class="row" style="gap:10px"><div class="field" style="flex:1;max-width:160px"><label for="${id}-tbars">Takte</label><select id="${id}-tbars" data-gt-ctl="tbars">${[1, 2, 3, 4, 5, 6, 7, 8].map((b) => `<option ${g.tab.bars === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div></div>
      <div class="gt-tabwrap">${tabSVG(g, { cursor: true })}</div>
      <div class="nt-grid-wrap"><table class="nt-grid gt-tgrid">${tRows}</table></div>
      ${sel ? `<div class="gt-pad" role="group" aria-label="Bund wählen für Saite ${STRING_NAMES[sel[0]]}">${Array.from({ length: 16 }, (_, f) => `<button type="button" class="chip" data-gt-act="fret" data-gt-id="${id}" data-f="${f}">${f}</button>`).join('')}<button type="button" class="chip" data-gt-act="fret" data-gt-id="${id}" data-f="-1">Löschen</button></div>` : '<p class="small muted">Feld antippen, dann Bund wählen.</p>'}
      <button type="button" class="btn small" data-gt-act="playTab" data-gt-id="${id}">Tabs abspielen</button>
    </div>`;
  }

  // Ansicht für Schüler (nur lesen, mit Abspielen)
  function viewHTML(g, id) {
    return `<div class="gt-view" id="${id}">
      ${g.capo ? `<span class="pill">Capo ${g.capo}. Bund</span>` : ''}
      ${g.chords.length ? `<div class="gt-chords">${g.chords.map((c) => chordSVG(c)).join('')}</div>` : ''}
      ${g.scale ? scaleBlock(g, id) : ''}
      ${g.strum.cells.some(Boolean) ? `<div class="gt-strumwrap">${strumSVG(g, { cursor: true })}</div>` : ''}
      ${g.tab.notes.length ? `<div class="gt-tabwrap">${tabSVG(g, { cursor: true })}</div>` : ''}
    </div>`;
  }
  const cycle = (c) => ({ '': 'D', D: 'U', U: 'X', X: '' }[c || '']);

  window.Guitar = { pitch: autoCorrelate, samplesLoaded: () => Object.keys(BUF).length, SYS, SCALES, scalePattern, scaleOrder, scaleSVG, scaleName, scaleToTab, scaleCursor, scalePositions, CHORDS, empty, parse, chordSVG, strumSVG, tabSVG, editorHTML, viewHTML, tunerHTML, tunerStart, tunerStop, play, stop, setTempo, cursorFor, capoTable, soundingKey, cycle, isPlaying: () => P.playing, NOTES_INT, label, strum: (n, d) => { audio(); strum(n, d, ctx.currentTime + 0.01, 0); } };
})();
