// Practice Hub Noten Editor für Schlagzeug: Raster, Notenbild (SVG), Song Chart und Wiedergabe mit Web Audio.
// Beat: { v:2, sig:'4/4'|'3/4'|'6/8'|'12/8', bars:1..16, bpm, tracks:{ cr:[schritte], ... }, stick:{ schritt:'R'|'L'|'K' (K = Bassdrum) }, dyn:{ 'hh:4':'a' betont | 's' leise }, marks:{ takt: 'Refrain' }, repeat:[takt, ...] }
// Ein Schritt ist eine 16tel. Ein Takt in repeat wiederholt den vorherigen ausgeschriebenen Takt (Prozentzeichen).
'use strict';
(function () {
  const ROWS = [
    { k: 'cr', n: 'Crash', p: 11, x: true }, // über der Hilfslinie (Otis Schreibweise 12.11.)
    { k: 'rd', n: 'Ride', p: 10, x: true }, // auf der Hilfslinie (Otis Schreibweise 12.11.)
    { k: 'hh', n: 'HiHat', p: 9, x: true },
    { k: 'ho', n: 'HiHat offen', p: 9, x: true, open: true },
    { k: 't1', n: 'Tom 1', p: 7 },
    { k: 'tr', n: 'Tom Rim', p: 7, x: true },
    { k: 't2', n: 'Tom 2', p: 6 },
    { k: 'sn', n: 'Snare', p: 5 },
    { k: 'gh', n: 'Ghost Note', p: 5, ghost: true },
    { k: 'ss', n: 'Sidestick', p: 5, x: true },
    { k: 'ft', n: 'Standtom', p: 3 },
    { k: 'bd', n: 'Bassdrum', p: 1, down: true },
    { k: 'hf', n: 'HiHat Fuß', p: -1, x: true, down: true },
  ];
  const BY = Object.fromEntries(ROWS.map((r) => [r.k, r]));
  const EXCLUSIVE = { hh: 'ho', ho: 'hh', sn: 'gh', gh: 'sn' };
  const MAX_BARS = 20;
  const SIGS = ['4/4', '3/4', '6/8', '12/8'];
  const EIGHTH = (sig) => sig === '6/8' || sig === '12/8'; // Achtel Takte: Tempo zählt Achtel, Gruppen zu drei Achteln
  const perBar = (sig) => ({ '3/4': 12, '6/8': 12, '12/8': 24 }[sig] || 16);
  const groupSize = (sig) => (EIGHTH(sig) ? 6 : 4);
  const total = (n) => perBar(n.sig) * n.bars;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function empty(sig = '4/4', bars = 1, bpm = 80) {
    const tracks = {}; ROWS.forEach((r) => { tracks[r.k] = []; });
    return { v: 2, sig, bars, bpm, tracks, stick: {}, dyn: {}, flam: {}, marks: {}, repeat: [], trip: [], tup: [], tupn: {}, tdyn: {}, tflam: {}, tstick: {} };
  }
  function parse(s) {
    if (!s) return null;
    try {
      const o = typeof s === 'string' ? JSON.parse(s) : s;
      if (o.kind === 'guitar') return null;
      const n = empty(SIGS.includes(o.sig) ? o.sig : '4/4', Math.min(MAX_BARS, Math.max(1, o.bars | 0 || 1)), o.bpm || 80);
      for (const [k, v] of Object.entries(o.stick || {})) if (Number(k) >= 0 && Number(k) < total(n) && (v === 'R' || v === 'L' || v === 'K')) n.stick[Number(k)] = v;
      ROWS.forEach((r) => { n.tracks[r.k] = (o.tracks && o.tracks[r.k] || []).filter((x) => x >= 0 && x < total(n)); });
      for (const [k, v] of Object.entries(o.marks || {})) if (Number(k) < n.bars && v) n.marks[Number(k)] = String(v).slice(0, 30);
      n.repeat = (o.repeat || []).map(Number).filter((b) => b > 0 && b < n.bars);
      n.trip = groupSize(n.sig) === 4 ? [...new Set((o.trip || []).map(Number).filter((g) => Number.isInteger(g) && g >= 0 && g < total(n) / 4))].sort((a, b) => a - b) : [];
      ROWS.forEach((r) => { n.tracks[r.k] = n.tracks[r.k].filter((i) => !(n.trip.includes(Math.floor(i / 4)) && i % 4 === 3)); });
      // Viertel Triolen (t 'q', zwei Schläge, 3 Noten) und 16tel Triolen (t '16', ein Schlag, 6 Noten); Noten in tupn als "Gruppe:Platz"
      const G = total(n) / 4, used = new Set(n.trip);
      n.tup = groupSize(n.sig) === 4 ? (o.tup || []).map((x) => ({ g: Number(x.g), t: x.t === 'q' ? 'q' : '16' })).filter((x) => Number.isInteger(x.g) && x.g >= 0 && x.g + (x.t === 'q' ? 1 : 0) < G
        && (x.t !== 'q' || Math.floor(x.g / (perBar(n.sig) / 4)) === Math.floor((x.g + 1) / (perBar(n.sig) / 4)))
        && !used.has(x.g) && !(x.t === 'q' && used.has(x.g + 1)) && (used.add(x.g), x.t === 'q' ? used.add(x.g + 1) : 0, true)) : [];
      n.tupn = {};
      for (const r of ROWS) { const l = ((o.tupn || {})[r.k] || []).filter((v) => { const [g, sl] = String(v).split(':').map(Number); const t = n.tup.find((x) => x.g === g); return t && Number.isInteger(sl) && sl >= 0 && sl < (t.t === '16' ? 6 : 3); }); if (l.length) n.tupn[r.k] = [...new Set(l.map(String))]; }
      // Triolen Noten: Akzent/leise (tdyn), Flam (tflam) je "Instrument:Gruppe:Platz", Sticking (tstick) je "Gruppe:Platz"
      n.tdyn = {}; n.tflam = {}; n.tstick = {};
      for (const [key, v] of Object.entries(o.tdyn || {})) { const [k, g, sl] = key.split(':'); if ((v === 'a' || v === 's') && tupHas(n, k, Number(g), Number(sl))) n.tdyn[key] = v; }
      for (const [key, v] of Object.entries(o.tflam || {})) { const [k, g, sl] = key.split(':'); if (v && tupHas(n, k, Number(g), Number(sl))) n.tflam[key] = 1; }
      for (const [key, v] of Object.entries(o.tstick || {})) { const [g, sl] = key.split(':').map(Number); const t = n.tup.find((x) => x.g === g); if (t && Number.isInteger(sl) && sl >= 0 && sl < tupSlots(t) && (v === 'R' || v === 'L' || v === 'K')) n.tstick[g + ':' + sl] = v; }
      for (const t of n.tup) for (const r of ROWS) n.tracks[r.k] = n.tracks[r.k].filter((i) => { const gi = Math.floor(i / 4); return gi !== t.g && !(t.t === 'q' && gi === t.g + 1); });
      for (const [key, v] of Object.entries(o.dyn || {})) { const [k, i] = key.split(':'); if ((v === 'a' || v === 's') && (n.tracks[k] || []).includes(Number(i))) n.dyn[k + ':' + Number(i)] = v; }
      for (const [key, v] of Object.entries(o.flam || {})) { const [k, i] = key.split(':'); if (v && (n.tracks[k] || []).includes(Number(i))) n.flam[k + ':' + Number(i)] = 1; }
      return n;
    } catch (e) { return null; }
  }
  // 8tel Triolen: eine Schlaggruppe (4 Sechzehntel) wird in drei gleiche Teile geteilt; Rasterplätze 0, 1, 2 sind die Triolen, Platz 3 bleibt leer
  const isTrip = (n, i) => groupSize(n.sig) === 4 && (n.trip || []).includes(Math.floor(i / 4));
  // Tuplet (Viertel oder 16tel Triole), das die Schlaggruppe g abdeckt
  const tupAt = (n, g) => (n.tup || []).find((t) => t.g === g || (t.t === 'q' && t.g + 1 === g)) || null;
  const tupSlots = (t) => (t.t === '16' ? 6 : 3);
  const tupHas = (n, k, g, sl) => ((n.tupn || {})[k] || []).includes(g + ':' + sl);
  function tupToggle(n, k, g, sl) { n.tupn = n.tupn || {}; const l = n.tupn[k] || [], key = g + ':' + sl; n.tupn[k] = l.includes(key) ? l.filter((x) => x !== key) : l.concat(key); if (!n.tupn[k].length) delete n.tupn[k]; if (!tupHas(n, k, g, sl)) { if (n.tdyn) delete n.tdyn[k + ':' + key]; if (n.tflam) delete n.tflam[k + ':' + key]; } }
  // Akzent, leise und Flam auch in Viertel und 16tel Triolen (Otis Wunsch 19.11.2026), gleiche Logik wie setDyn
  const tupDyn = (n, k, g, sl) => (n.tdyn || {})[k + ':' + g + ':' + sl] || '';
  const tupFlam = (n, k, g, sl) => !!(n.tflam || {})[k + ':' + g + ':' + sl];
  function tupSetDyn(n, k, g, sl, v) {
    const key = k + ':' + g + ':' + sl, on = tupHas(n, k, g, sl);
    if (v === 'f') { n.tflam = n.tflam || {}; if (!on) { tupToggle(n, k, g, sl); n.tflam[key] = 1; } else if (n.tflam[key]) tupToggle(n, k, g, sl); else n.tflam[key] = 1; return; }
    n.tdyn = n.tdyn || {};
    if (!on) { tupToggle(n, k, g, sl); n.tdyn[key] = v; return; }
    if (n.tdyn[key] === v) tupToggle(n, k, g, sl); else n.tdyn[key] = v;
  }
  function tupStick(n, g, sl) { n.tstick = n.tstick || {}; const key = g + ':' + sl, v = n.tstick[key]; if (!v) n.tstick[key] = 'R'; else if (v === 'R') n.tstick[key] = 'L'; else if (v === 'L') n.tstick[key] = 'K'; else delete n.tstick[key]; }
  // Aufräumen: Triolen Zusätze ohne gültige Triole oder Note entfernen
  function cleanTup(n) {
    for (const key of Object.keys(n.tdyn || {})) { const [k, g, sl] = key.split(':'); if (!tupHas(n, k, Number(g), Number(sl))) delete n.tdyn[key]; }
    for (const key of Object.keys(n.tflam || {})) { const [k, g, sl] = key.split(':'); if (!tupHas(n, k, Number(g), Number(sl))) delete n.tflam[key]; }
    for (const key of Object.keys(n.tstick || {})) { const g = Number(key.split(':')[0]); if (!(n.tup || []).some((t) => t.g === g)) delete n.tstick[key]; }
  }
  // Schlag g umstellen: '' normal, '8' 8tel Triole, '16' 16tel Triole, 'q' Viertel Triole (mit dem nächsten Schlag im selben Takt)
  function setTuplet(n, g, type) {
    const bpb = perBar(n.sig) / 4;
    const clearGroup = (gg) => { for (const k in n.tracks) n.tracks[k] = n.tracks[k].filter((i) => Math.floor(i / 4) !== gg); for (const key of Object.keys(n.stick || {})) if (Math.floor(Number(key) / 4) === gg) delete n.stick[key]; };
    const dropTup = (t) => { n.tup = n.tup.filter((x) => x !== t); for (const k of Object.keys(n.tupn || {})) { n.tupn[k] = n.tupn[k].filter((v) => Number(v.split(':')[0]) !== t.g); if (!n.tupn[k].length) delete n.tupn[k]; } };
    n.tup = n.tup || []; n.tupn = n.tupn || {};
    const span = type === 'q' ? [g, g + 1] : [g];
    if (type === 'q' && (Math.floor((g + 1) / bpb) !== Math.floor(g / bpb) || g + 1 >= total(n) / 4)) return false;
    for (const gg of span) { const t = tupAt(n, gg); if (t) dropTup(t); n.trip = (n.trip || []).filter((x) => x !== gg); }
    cleanTup(n);
    if (type === '8') { setTrip(n, g, true); return true; }
    if (type === '16' || type === 'q') { for (const gg of span) clearGroup(gg); n.tup.push({ g, t: type }); n.tup.sort((a, b) => a.g - b.g); }
    return true;
  }
  const tupleType = (n, g) => ((n.trip || []).includes(g) ? '8' : (tupAt(n, g) || {}).t || '');
  function setTrip(n, g, on) {
    n.trip = (n.trip || []).filter((x) => x !== g); if (!on) return;
    n.trip.push(g); n.trip.sort((a, b) => a - b);
    const drop = g * 4 + 3; for (const k in n.tracks) n.tracks[k] = n.tracks[k].filter((i) => i !== drop);
    if (n.stick) delete n.stick[drop];
  }
  const has = (n, k, i) => (k === 'stick' ? !!(n.stick || {})[i] : (n.tracks[k] || []).includes(i));
  function toggle(n, k, i) {
    if (isTrip(n, i) && i % 4 === 3) return;
    if (k === 'stick') { n.stick = n.stick || {}; const v = n.stick[i]; if (!v) n.stick[i] = 'R'; else if (v === 'R') n.stick[i] = 'L'; else if (v === 'L') n.stick[i] = 'K'; else delete n.stick[i]; return; }
    const t = n.tracks[k];
    if (t.includes(i)) { n.tracks[k] = t.filter((x) => x !== i); if (n.dyn) delete n.dyn[k + ':' + i]; if (n.flam) delete n.flam[k + ':' + i]; }
    else { t.push(i); t.sort((a, b) => a - b); const ex = EXCLUSIVE[k]; if (ex) n.tracks[ex] = n.tracks[ex].filter((x) => x !== i); }
  }
  // Dynamik: 'a' betont (lauter, Akzent >), 's' leise (kleiner, in Klammern). Setzt die Note, falls sie fehlt.
  const dynOf = (n, k, i) => (n.dyn || {})[k + ':' + i] || '';
  // Flam: kleine Vorschlagsnote direkt vor der Hauptnote, unabhängig von betont/leise
  const flamOf = (n, k, i) => !!(n.flam || {})[k + ':' + i];
  function setDyn(n, k, i, v) {
    const key = k + ':' + i;
    if (v === 'f') {
      n.flam = n.flam || {};
      if (!(n.tracks[k] || []).includes(i)) { toggle(n, k, i); n.flam[key] = 1; }
      else if (n.flam[key]) toggle(n, k, i); // nochmal Flam: Note entfernen
      else n.flam[key] = 1;
      return;
    }
    n.dyn = n.dyn || {};
    if (!(n.tracks[k] || []).includes(i)) { toggle(n, k, i); n.dyn[key] = v; return; }
    if (n.dyn[key] === v) toggle(n, k, i); // gleiche Dynamik nochmal: Note entfernen
    else n.dyn[key] = v;
  }
  function countLabel(sig, i) {
    const j = i % perBar(sig);
    if (EIGHTH(sig)) return j % 2 === 0 ? String(j / 2 + 1) : '&';
    return [String(Math.floor(j / 4) + 1), 'e', '&', 'a'][j % 4];
  }
  // Takt, den ein Wiederholungstakt tatsächlich spielt
  function sourceBar(n, bar) { let b = bar; while (b > 0 && n.repeat.includes(b)) b--; return b; }
  function setBars(n, bars) {
    n.bars = Math.max(1, Math.min(MAX_BARS, bars));
    const max = total(n);
    for (const k in n.tracks) n.tracks[k] = n.tracks[k].filter((i) => i < max);
    for (const k of Object.keys(n.stick || {})) if (Number(k) >= max) delete n.stick[k];
    for (const key of Object.keys(n.dyn || {})) if (Number(key.split(':')[1]) >= max) delete n.dyn[key];
    for (const key of Object.keys(n.flam || {})) if (Number(key.split(':')[1]) >= max) delete n.flam[key];
    n.repeat = n.repeat.filter((b) => b < n.bars);
    n.trip = (n.trip || []).filter((g) => g * 4 < max);
    n.tup = (n.tup || []).filter((t) => (t.g + (t.t === 'q' ? 1 : 0)) * 4 < max);
    for (const k of Object.keys(n.tupn || {})) { n.tupn[k] = n.tupn[k].filter((v) => n.tup.some((t) => t.g === Number(v.split(':')[0]))); if (!n.tupn[k].length) delete n.tupn[k]; }
    cleanTup(n);
    for (const k of Object.keys(n.marks)) if (Number(k) >= n.bars) delete n.marks[k];
  }

  // ---------- Notenbild ----------
  // Viertel Triole (3 Viertel über 2 Schläge, Klammer mit 3) und 16tel Triole (6 Sechzehntel auf 1 Schlag, zweimal 3)
  function tupGlyphs(n, tp, g, keys, down, xOf, sw, gs, ink) {
    const out = [], slots = tupSlots(tp), width = (tp.t === 'q' ? 2 : 1) * gs * sw, XS = (sl) => xOf(g) + (sl * width) / slots;
    const notes = [];
    for (let sl = 0; sl < slots; sl++) { const hits = keys.filter((k) => tupHas(n, k, tp.g, sl)).map((k) => BY[k]); if (hits.length) notes.push({ sl, hits, top: Math.max(...hits.map((h) => h.p)), bot: Math.min(...hits.map((h) => h.p)) }); }
    if (!down) for (let sl = 0; sl < slots; sl++) if (!notes.some((nt) => nt.sl === sl)) out.push(restGlyph(tp.t === '16' ? 1 : 4, XS(sl), ink));
    if (!notes.length) return out.join('');
    const sx = (nt) => XS(nt.sl) + (down ? -5.5 : 5.5);
    const tipY = down ? Math.max(...notes.map((nt) => yOf(nt.bot) + 30)) : Math.min(...notes.map((nt) => yOf(nt.top) - 30));
    const beamed = tp.t === '16' && notes.length > 1;
    for (const nt of notes) {
      for (const h of nt.hits) { const d = tupDyn(n, h.k, tp.g, nt.sl); out.push(head(d === 's' && !h.ghost ? { ...h, ghost: true } : h, XS(nt.sl), ink)); if (tupFlam(n, h.k, tp.g, nt.sl)) out.push(grace(h, XS(nt.sl) - (d === 's' ? 19 : 13), ink, down)); }
      const fromY = down ? yOf(nt.top) : yOf(nt.bot), toY = beamed || tp.t === 'q' ? tipY : (down ? yOf(nt.bot) + 30 : yOf(nt.top) - 30);
      out.push(`<line x1="${sx(nt)}" x2="${sx(nt)}" y1="${fromY}" y2="${toY}" stroke="${ink}" stroke-width="1.3"/>`);
      if (tp.t === '16' && !beamed) for (let f = 0; f < 2; f++) { const fy = toY + (down ? -f * 7 : f * 7); out.push(`<path d="M${sx(nt)} ${fy} q 9 ${down ? -6 : 6} 7 ${down ? -15 : 15}" fill="none" stroke="${ink}" stroke-width="2"/>`); }
    }
    for (const nt of notes) if (nt.hits.some((h) => tupDyn(n, h.k, tp.g, nt.sl) === 'a')) {
      const ay = down ? Math.max(tipY, yOf(nt.bot) + 30) + 12 : Math.min(tipY, yOf(nt.top) - 30) - 6, x = XS(nt.sl);
      out.push(`<path d="M${x - 5} ${ay - 4} L${x + 5} ${ay} L${x - 5} ${ay + 4}" fill="none" stroke="${ink}" stroke-width="1.6"/>`);
    }
    if (beamed) { const a = sx(notes[0]), b = sx(notes[notes.length - 1]); out.push(`<rect x="${a - 0.6}" y="${tipY - (down ? 4 : 0)}" width="${b - a + 1.2}" height="4" fill="${ink}"/><rect x="${a - 0.6}" y="${tipY + (down ? -11 : 7)}" width="${b - a + 1.2}" height="4" fill="${ink}"/>`); }
    if (down && notes.length < 2) return out.join(''); // einzelne Fußnote: Kennzeichnung steht in der Oberstimme
    const ly = down ? tipY + 16 : Math.max(10, tipY - 6);
    const label = (x) => `<text x="${x}" y="${ly}" text-anchor="middle" font-size="11" font-weight="700" font-style="italic" font-family="Georgia, serif" fill="${ink}">3</text>`;
    if (tp.t === '16') { out.push(label(XS(1) + 5.5)); out.push(label(XS(4) + 5.5)); }
    else { const a = XS(0) - 2, b = XS(2) + 12, by = down ? ly - 4 : ly - 4; out.push(`<path d="M${a} ${by + (down ? -5 : 5)} V${by} H${(a + b) / 2 - 7} M${(a + b) / 2 + 7} ${by} H${b} V${by + (down ? -5 : 5)}" fill="none" stroke="${ink}" stroke-width="1.1"/>`); out.push(label((a + b) / 2).replace(`y="${ly}"`, `y="${by + 4}"`)); }
    return out.join('');
  }
  const LINE0 = 86;
  const yOf = (p) => LINE0 - p * 5;
  // Zeichnet die Takte [from, to) als eine Notenzeile
  function renderLine(n, from, to, opt) {
    // 16tel Triolen (6 Noten auf einem Schlag) brauchen mehr Platz, sonst berühren Vorschlag und Klammern die Nachbarnote
    const t16 = (n.tup || []).some((t) => t.t === '16' && t.g * 4 >= from * perBar(n.sig) && t.g * 4 < to * perBar(n.sig));
    const sw = (opt.stepWidth || 22) * (t16 ? 1.7 : 1), pb = perBar(n.sig), gs = groupSize(n.sig), first = from === 0;
    const x0 = first ? 58 : 26, steps = (to - from) * pb;
    const sticks = Object.entries(n.stick || {}).filter(([i]) => i >= from * pb && i < to * pb && !n.repeat.includes(Math.floor(i / pb)));
    const W = x0 + steps * sw + 14, H = 130, ink = 'currentColor', out = [];
    const xOf = (i) => x0 + (i - from * pb) * sw + 8;
    for (let l = 0; l < 5; l++) out.push(`<line x1="6" x2="${W - 6}" y1="${yOf(l * 2)}" y2="${yOf(l * 2)}" stroke="${ink}" stroke-width="1" opacity=".55"/>`);
    if (first) {
      out.push(`<rect x="12" y="${yOf(6)}" width="4" height="20" fill="${ink}"/><rect x="20" y="${yOf(6)}" width="4" height="20" fill="${ink}"/>`);
      const [a, b] = n.sig.split('/');
      out.push(`<text x="40" y="${yOf(6) + 1}" text-anchor="middle" font-size="19" font-weight="700" font-family="Georgia, serif" fill="${ink}">${a}</text><text x="40" y="${yOf(2) + 1}" text-anchor="middle" font-size="19" font-weight="700" font-family="Georgia, serif" fill="${ink}">${b}</text>`);
    } else {
      out.push(`<text x="8" y="${yOf(8) - 6}" font-size="10" fill="${ink}" opacity=".6">${from + 1}</text>`);
    }
    for (let bar = from; bar < to; bar++) {
      const bx = x0 + (bar - from + 1) * pb * sw - 3, sx = x0 + (bar - from) * pb * sw;
      out.push(`<line x1="${bx}" x2="${bx}" y1="${yOf(8)}" y2="${yOf(0)}" stroke="${ink}" stroke-width="${bar === n.bars - 1 ? 2.5 : 1}"/>`);
      if (n.marks[bar]) out.push(`<text x="${sx + 4}" y="14" font-size="12" font-weight="700" fill="${ink}">${esc(n.marks[bar])}</text>`);
      if (n.repeat.includes(bar)) {
        const cx = sx + (pb * sw) / 2;
        out.push(`<line x1="${cx - 9}" y1="${yOf(2)}" x2="${cx + 9}" y2="${yOf(6)}" stroke="${ink}" stroke-width="4"/><circle cx="${cx - 8}" cy="${yOf(5.4)}" r="2.6" fill="${ink}"/><circle cx="${cx + 8}" cy="${yOf(2.6)}" r="2.6" fill="${ink}"/>`);
      }
    }
    for (const down of [false, true]) {
      const keys = ROWS.filter((r) => !!r.down === down).map((r) => r.k);
      const onsets = [...new Set(keys.flatMap((k) => n.tracks[k]))].sort((x, y) => x - y);
      for (let g = from * pb; g < to * pb; g += gs) {
        if (n.repeat.includes(Math.floor(g / pb))) continue;
        const tp = gs === 4 ? tupAt(n, g / 4) : null;
        if (tp) { if (tp.g === g / 4) out.push(tupGlyphs(n, tp, g, keys, down, xOf, sw, gs, ink)); continue; }
        const inG = onsets.filter((i) => i >= g && i < g + gs);
        const trip = isTrip(n, g), X = (i) => (trip ? xOf(g) + ((i - g) * gs * sw) / 3 : xOf(i));
        if (!inG.length) { if (!down) out.push(restGlyph(gs, xOf(g) + (gs / 2) * sw - 12, ink)); continue; }
        if (!down && trip) { for (let t = 0; t < 3; t++) if (!inG.includes(g + t)) out.push(restGlyph(2, X(g + t), ink)); }
        else if (!down && inG[0] > g) out.push(restGlyph(inG[0] - g, xOf(g), ink));
        const notes = inG.map((i, idx) => {
          const end = idx + 1 < inG.length ? inG[idx + 1] : g + gs;
          const dur = end - i;
          const hits = keys.filter((k) => n.tracks[k].includes(i)).map((k) => BY[k]);
          const ps = hits.map((h) => h.p);
          if (trip) return { i, dur, hits, top: Math.max(...ps), bot: Math.min(...ps), beams: 1, dot: false };
          return { i, dur, hits, top: Math.max(...ps), bot: Math.min(...ps), beams: dur === 1 ? 2 : dur <= 3 ? 1 : 0, dot: dur === 3 || dur === 6 };
        });
        const sx = (nt) => X(nt.i) + (down ? -5.5 : 5.5);
        const tipY = down ? Math.max(...notes.map((nt) => yOf(nt.bot) + 30)) : Math.min(...notes.map((nt) => yOf(nt.top) - 30));
        const beamed = notes.length > 1 && notes.every((nt) => nt.beams > 0);
        for (const nt of notes) {
          for (const h of nt.hits) {
            const d = dynOf(n, h.k, nt.i);
            // Zuletzt angetippter Schlag im Editor: farbig hinterlegt
            if (opt.sel && opt.sel.k === h.k && opt.sel.i === nt.i) out.push(`<circle class="nt-selmark" cx="${X(nt.i)}" cy="${yOf(h.p)}" r="9.5" fill="var(--ring2, #7a5a3a)" opacity=".45"/>`);
            out.push(head(d === 's' && !h.ghost ? { ...h, ghost: true } : h, X(nt.i), ink));
            if (flamOf(n, h.k, nt.i)) out.push(grace(h, X(nt.i) - (d === 's' ? 19 : 13), ink, down));
          }
          if (nt.dot) out.push(`<circle cx="${X(nt.i) + 10}" cy="${yOf(nt.top % 2 === 0 ? nt.top + 1 : nt.top)}" r="1.8" fill="${ink}"/>`);
          const fromY = down ? yOf(nt.top) : yOf(nt.bot);
          const toY = beamed ? tipY : (down ? yOf(nt.bot) + 30 : yOf(nt.top) - 30);
          out.push(`<line x1="${sx(nt)}" x2="${sx(nt)}" y1="${fromY}" y2="${toY}" stroke="${ink}" stroke-width="1.3"/>`);
          if (!beamed && nt.beams > 0) for (let f = 0; f < nt.beams; f++) {
            const fy = toY + (down ? -f * 7 : f * 7);
            out.push(`<path d="M${sx(nt)} ${fy} q 9 ${down ? -6 : 6} 7 ${down ? -15 : 15}" fill="none" stroke="${ink}" stroke-width="2"/>`);
          }
        }
        // Akzente: > über der Oberstimme, unter der Unterstimme
        for (const nt of notes) if (nt.hits.some((h) => dynOf(n, h.k, nt.i) === 'a')) {
          const ay = down ? Math.max(tipY, yOf(nt.bot) + 30) + 12 : Math.min(tipY, yOf(nt.top) - 30) - 6;
          out.push(`<path d="M${X(nt.i) - 5} ${ay - 4} L${X(nt.i) + 5} ${ay} L${X(nt.i) - 5} ${ay + 4}" fill="none" stroke="${ink}" stroke-width="1.6"/>`);
        }
        if (trip) { const mx = (sx(notes[0]) + sx(notes[notes.length - 1])) / 2 || sx(notes[0]); out.push(`<text x="${trip && notes.length === 1 ? X(g + 1) + 5 : mx}" y="${down ? tipY + 16 : tipY - 5}" text-anchor="middle" font-size="11" font-weight="700" font-style="italic" font-family="Georgia, serif" fill="${ink}">3</text>`); }
        if (beamed) {
          const dir = down ? -1 : 1;
          out.push(`<rect x="${sx(notes[0]) - 0.6}" y="${tipY - (down ? 4 : 0)}" width="${sx(notes[notes.length - 1]) - sx(notes[0]) + 1.2}" height="4" fill="${ink}"/>`);
          notes.forEach((nt, idx) => {
            if (nt.beams < 2) return;
            const y2 = tipY + dir * 7 - (down ? 4 : 0);
            const next = notes[idx + 1], prev = notes[idx - 1];
            if (next && next.beams === 2) out.push(`<rect x="${sx(nt) - 0.6}" y="${y2}" width="${sx(next) - sx(nt) + 1.2}" height="4" fill="${ink}"/>`);
            else if (!(prev && prev.beams === 2)) { const w = 8, left = next ? sx(nt) : sx(nt) - w; out.push(`<rect x="${left - 0.6}" y="${y2}" width="${w + 1.2}" height="4" fill="${ink}"/>`); }
          });
        }
      }
    }
    if (opt.cursor) out.push(`<rect class="nt-cursor" x="0" y="20" width="${sw - 2}" height="${H - 26}" rx="4" fill="var(--ring, #b0502b)" opacity="0"/>`);
    // Platz oben für Akzente der Oberstimme
    const inLine = (g) => g * 4 >= from * pb && g * 4 < to * pb && !n.repeat.includes(Math.floor((g * 4) / pb));
    const top = Object.entries(n.dyn || {}).some(([key, v]) => { const [k, i] = key.split(':'); return v === 'a' && !(BY[k] && BY[k].down) && Number(i) >= from * pb && Number(i) < to * pb; })
      || Object.entries(n.tdyn || {}).some(([key, v]) => { const [k, g] = key.split(':'); return v === 'a' && !(BY[k] && BY[k].down) && inLine(Number(g)); }) ? 14 : 0;
    // Sticking in Viertel und 16tel Triolen: x wie in tupGlyphs
    const tsticks = Object.entries(n.tstick || {}).map(([key, v]) => { const [g, sl] = key.split(':').map(Number), tp = (n.tup || []).find((t) => t.g === g); return tp && inLine(g) ? [xOf(g * 4) + (sl * (tp.t === 'q' ? 2 : 1) * gs * sw) / tupSlots(tp), v] : null; }).filter(Boolean);
    // Sticking über den Noten (Otis Wunsch 18.11.2026), eine feste Zeile ganz oben, über Akzenten und Halsen
    const sTop = sticks.length || tsticks.length ? 18 : 0;
    for (const [x, v] of tsticks) out.push(`<text class="nt-stick-txt" x="${x}" y="${-top - 5}" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${ink}">${v}</text>`);
    for (const [i, v] of sticks) out.push(`<text class="nt-stick-txt" x="${xOf(Number(i))}" y="${-top - 5}" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${ink}">${v}</text>`);
    if (opt.loop || opt.loopPick) {
      const L = opt.loop;
      for (let bar = from; bar < to; bar++) {
        const sx = x0 + (bar - from) * pb * sw - 3, w = pb * sw, inL = L && bar >= L.from && bar < L.to;
        if (L && !inL) out.push(`<rect x="${sx}" y="${-top - 20}" width="${w}" height="${H + top + 20}" style="fill:var(--sunk)" opacity=".7"/>`);
        if (inL) out.push(`<rect x="${sx}" y="${yOf(8) - 4}" width="${w}" height="${yOf(0) - yOf(8) + 8}" style="fill:var(--accent)" opacity=".1"/>`);
        if (inL && bar === L.from) out.push(`<rect class="nt-loop-a" x="${sx - 1.5}" y="${yOf(8) - 12}" width="3" height="${yOf(0) - yOf(8) + 24}" rx="1.5" style="fill:var(--ring2)"/><circle cx="${sx}" cy="${yOf(8) - 14}" r="5" style="fill:var(--ring2)"/>`);
        if (inL && bar === L.to - 1) out.push(`<rect class="nt-loop-b" x="${sx + w - 1.5}" y="${yOf(8) - 12}" width="3" height="${yOf(0) - yOf(8) + 24}" rx="1.5" style="fill:var(--ring2)"/><circle cx="${sx + w}" cy="${yOf(0) + 14}" r="5" style="fill:var(--ring2)"/>`);
        if (opt.loopPick) out.push(`<rect class="nt-barhit" data-act="loopBar" data-bar="${bar}" x="${sx}" y="${-top - 20}" width="${w}" height="${H + top + 20}" fill="transparent" style="cursor:pointer"><title>Takt ${bar + 1}</title></rect>`);
      }
    }
    return `<svg class="nt-svg" viewBox="0 ${-top - sTop} ${W} ${H + top + sTop}" width="${W}" height="${H + top + sTop}" role="img" aria-label="${esc(opt.label || 'Schlagzeug Noten')}${from ? ', ab Takt ' + (from + 1) : ''}" data-x0="${x0}" data-sw="${sw}" data-from="${from * pb}" data-to="${to * pb}">${out.join('')}</svg>`;
  }
  function render(n, opt = {}) {
    if (!n) return '';
    const build = (per) => { const lines = []; for (let b = 0; b < n.bars; b += per) lines.push(renderLine(n, b, Math.min(n.bars, b + per), opt)); return lines.length > 1 ? `<div class="nt-lines">${lines.join('')}</div>` : lines[0]; };
    if (opt.barsPerLine || n.bars === 1) return build(opt.barsPerLine || 1);
    // Standard: Laptop 2 Takte pro Zeile, Handy 1 Takt pro Zeile (per CSS umgeschaltet)
    return `<div class="nt-wide">${build(2)}</div><div class="nt-narrow">${build(1)}</div>`;
  }
  // Vorschlagsnote (Flam): kleiner Kopf, eigener Hals mit Fähnchen und Schrägstrich
  function grace(h, x, ink, down) {
    const y = yOf(h.p), dir = down ? 1 : -1, sx = x + (down ? -3.2 : 3.2), ty = y + dir * 17;
    const hd = h.x ? `<path d="M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x + 3} ${y - 3} L${x - 3} ${y + 3}" stroke="${ink}" stroke-width="1.3"/>` : `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="2.6" transform="rotate(-20 ${x} ${y})" fill="${ink}"/>`;
    return `<g class="nt-grace">${hd}<line x1="${sx}" x2="${sx}" y1="${y}" y2="${ty}" stroke="${ink}" stroke-width="1"/><path d="M${sx} ${ty} q 6 ${-dir * 4} 4 ${-dir * 10}" fill="none" stroke="${ink}" stroke-width="1.3"/><line x1="${sx - 4}" y1="${ty - dir * 9}" x2="${sx + 6}" y2="${ty - dir * 1}" stroke="${ink}" stroke-width="1"/></g>`;
  }
  function head(h, x, ink) {
    const y = yOf(h.p), parts = [];
    if (h.p >= 10) parts.push(`<line x1="${x - 9}" x2="${x + 9}" y1="${yOf(10)}" y2="${yOf(10)}" stroke="${ink}" stroke-width="1"/>`);
    if (h.x) parts.push(`<path d="M${x - 4.5} ${y - 4.5} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y - 4.5} L${x - 4.5} ${y + 4.5}" stroke="${ink}" stroke-width="1.8"/>`);
    else parts.push(`<ellipse cx="${x}" cy="${y}" rx="5.6" ry="4" transform="rotate(-20 ${x} ${y})" fill="${ink}"/>`);
    if (h.open) parts.push(`<circle cx="${x}" cy="${y}" r="7.2" fill="none" stroke="${ink}" stroke-width="1.4"/>`); // offene HiHat: X im Kreis (Otis Schreibweise 16.11.)
    if (h.ghost) parts.push(`<text x="${x - 11}" y="${y + 4}" font-size="13" fill="${ink}" font-family="Georgia, serif">(</text><text x="${x + 7}" y="${y + 4}" font-size="13" fill="${ink}" font-family="Georgia, serif">)</text>`);
    return parts.join('');
  }
  function restGlyph(steps, x, ink) {
    const y = yOf(4);
    if (steps >= 4) {
      return `<path d="M${x} ${y - 13} l6 7 l-5 6 l6 7 c-5 -2 -8 1 -4 6" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` + (steps === 6 ? `<circle cx="${x + 12}" cy="${y - 2}" r="1.8" fill="${ink}"/>` : '');
    }
    const flags = steps === 1 ? 2 : 1;
    let d = '';
    for (let f = 0; f < flags; f++) d += `<circle cx="${x + 1 - f * 2}" cy="${y - 6 + f * 7}" r="2.6" fill="${ink}"/><path d="M${x + 2 - f * 2} ${y - 5 + f * 7} q4 1 6 -3" stroke="${ink}" stroke-width="1.5" fill="none"/>`;
    return d + `<line x1="${x + 8}" y1="${y - 8}" x2="${x + 2 - (flags - 1) * 3}" y2="${y + 10 + (flags - 1) * 5}" stroke="${ink}" stroke-width="1.5"/>` + (steps === 3 ? `<circle cx="${x + 12}" cy="${y - 6}" r="1.8" fill="${ink}"/>` : '');
  }

  // ---------- Klang ----------
  let ctx = null, noiseBuf = null;
  function audio() {
    ctx = ctx || (window.__phAudio = window.__phAudio || new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return ctx;
  }
  function env(g, t, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function noise(t, dur, peak, type, freq) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; env(g, t, peak, dur);
    s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  function tone(t, f0, f1, dur, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); env(g, t, peak, dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SOUND = {
    bd: (t) => tone(t, 140, 45, 0.28, 0.9),
    sn: (t) => { noise(t, 0.16, 0.5, 'highpass', 1500); tone(t, 220, 160, 0.08, 0.35); },
    gh: (t) => noise(t, 0.07, 0.12, 'highpass', 1800),
    hh: (t) => noise(t, 0.04, 0.25, 'highpass', 7500),
    ho: (t) => noise(t, 0.32, 0.22, 'highpass', 7000),
    hf: (t) => noise(t, 0.05, 0.18, 'bandpass', 6000),
    rd: (t) => { noise(t, 0.45, 0.12, 'bandpass', 5500); tone(t, 620, 600, 0.3, 0.05); },
    cr: (t) => noise(t, 1.1, 0.3, 'highpass', 4500),
    t1: (t) => tone(t, 260, 190, 0.22, 0.6),
    t2: (t) => tone(t, 200, 140, 0.25, 0.6),
    ft: (t) => tone(t, 130, 85, 0.35, 0.7),
    // Sidestick und Tom Rim: kurzer Holz Klack (noch keine echten Samples)
    ss: (t) => { tone(t, 1700, 1100, 0.035, 0.4); noise(t, 0.03, 0.25, 'bandpass', 3000); },
    tr: (t) => { tone(t, 950, 700, 0.04, 0.35); noise(t, 0.03, 0.2, 'bandpass', 2400); tone(t, 260, 200, 0.08, 0.15); },
  };
  // Echte Samples aus Otis Bibliothek: Kick, Snare (Mystery Snare Dry), Toms, Crash, HiHat. Ride: VCSL Becken mit Stock (CC0, Versilian Studios).
  const SAMPLE = { bd: 0.95, sn: 0.8, gh: 0.18, t1: 0.75, t2: 0.75, ft: 0.8, cr: 0.45, hh: 0.45, ho: 0.45, hf: 0.3, rd: 0.4 };
  const SRC = { gh: 'sn', hf: 'hh' };
  const BUF = {}; let loading = null, samplesReady = false;
  // Gleiche Versionsnummer wie notation.js?v=…, damit neue Samples nach Updates sicher geladen werden
  const VER = (() => { const s = document.querySelector('script[src*="notation.js"]'); const m = s && /\?v=\d+/.exec(s.getAttribute('src')); return m ? m[0] : ''; })();
  function loadSamples() {
    if (loading || !ctx || typeof fetch !== 'function') return loading;
    loading = Promise.all(['bd', 'sn', 't1', 't2', 'ft', 'cr', 'hh', 'ho', 'rd'].map((k) => fetch(new URL('samples/' + k + '.mp3' + VER, location.href)).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => ab && new Promise((ok) => ctx.decodeAudioData(ab, ok, () => ok(null)))).then((b) => { if (b) BUF[k] = b; }).catch(() => {})))
      .then(() => { samplesReady = true; });
    return loading;
  }
  function sample(k, t, v = 1) {
    const b = BUF[SRC[k] || k]; if (!b) return false;
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = Math.min(1.6, SAMPLE[k] * v * (P.vol == null ? 1 : P.vol));
    s.connect(g).connect(ctx.destination); s.start(t);
    // Offene HiHat wird von der geschlossenen abgedämpft
    if ((k === 'hh' || k === 'hf') && P.openHat) { try { P.openHat.stop(t); } catch (e) { /* schon zu Ende */ } P.openHat = null; }
    if (k === 'ho') P.openHat = s;
    return true;
  }
  const DYN_GAIN = { a: 1.7, s: 0.35 };
  function hit(k, t, dyn) { audio(); loadSamples(); t = t || ctx.currentTime + 0.01; if (!(SAMPLE[k] && sample(k, t, DYN_GAIN[dyn] || 1))) (SOUND[k] || SOUND.sn)(t); }

  // ---------- Metronom Klick (auch für das Metronom der App) ----------
  // level: 2 betont, 1 normal, 0.5 Unterteilung
  const CLICKS = {
    klick: (t, l, v) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = l >= 2 ? 1600 : l >= 1 ? 1000 : 800; env(g, t, 0.6 * v * (l >= 1 ? 1 : 0.45), 0.05); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.07); },
    holz: (t, l, v) => { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = l >= 2 ? 1250 : l >= 1 ? 950 : 800; f.type = 'bandpass'; f.frequency.value = o.frequency.value; f.Q.value = 4; env(g, t, 0.9 * v * (l >= 1 ? 1 : 0.4), 0.06); o.connect(f).connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.08); },
    beep: (t, l, v) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = l >= 2 ? 1320 : l >= 1 ? 880 : 660; env(g, t, 0.18 * v * (l >= 1 ? 1 : 0.5), 0.08); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.1); },
    kuhglocke: (t, l, v) => { [540, 800].forEach((fr) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = fr * (l >= 2 ? 1.25 : 1); env(g, t, 0.09 * v * (l >= 1 ? 1 : 0.45), 0.18); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.2); }); },
    rimclick: (t, l, v) => { noise(t, 0.03, 0.5 * v * (l >= 1 ? (l >= 2 ? 1 : 0.7) : 0.3), 'highpass', 2500); tone(t, 1700, 1500, 0.02, 0.2 * v); },
  };
  function click(t, level, sound, vol) { audio(); if (!level) return; (CLICKS[sound] || CLICKS.klick)(t || ctx.currentTime + 0.01, level, vol == null ? 0.8 : vol); }
  // Klick beim Beat: { on, accents: [2,1,1,1], sub: 1|2|4, sound, vol }
  let CLICK = { on: false, accents: null, sub: 1, sound: 'klick', vol: 0.8 };
  function setClick(o) { CLICK = Object.assign({}, CLICK, o || {}); }

  // ---------- Wiedergabe: Schleife, Tempo Trainer, Stummschalten ----------
  const P = { playing: false, timer: null, next: 0, step: 0, n: null, bpm: 80, queue: [], onStep: null, mute: new Set(), trainer: null, onTempo: null, loop: null };
  // Takt Loop (Otis Wunsch 25.11.2026): { from, to } in Takten, to exklusiv; null = ganzer Beat
  const loopOf = (n, l) => (l && n && l.from >= 0 && l.to > l.from && l.to <= n.bars ? { from: l.from | 0, to: l.to | 0 } : null);
  function play(n, bpm, onStep, opts = {}) {
    stop(); audio();
    Object.assign(P, { n, bpm: bpm || n.bpm || 80, onStep, playing: true, step: 0, queue: [], mute: new Set(opts.mute || []), trainer: opts.trainer || null, onTempo: opts.onTempo || null, loop: loopOf(n, opts.loop) });
    const token = P.token = (P.token || 0) + 1;
    const go = () => {
      if (!P.playing || P.token !== token) return; P.next = ctx.currentTime + 0.08;
      // 1 Takt Metronom Vorlauf (Otis Wunsch 19.11.2026): nur vor dem ersten Durchlauf, danach Schleife ohne Pause ab Takt 1.
      // opts.countIn: Faktor (1 normal, 2 bei doppelt ausgeschriebenen Bausteinen), damit der Vorlauf einen echten Takt dauert
      if (opts.countIn) {
        const f = Number(opts.countIn) || 1, eighth = EIGHTH(n.sig), beats = perBar(n.sig) / (eighth ? 2 : 4), beat = (60 / P.bpm) * f / (eighth ? 2 : 1);
        for (let b = 0; b < beats; b++) click(P.next + b * beat, b === 0 ? 2 : 1, CLICK.sound || 'klick', CLICK.vol == null ? 0.8 : CLICK.vol);
        P.next += beats * beat;
      }
      P.timer = setInterval(schedule, 25); requestAnimationFrame(draw);
    };
    // Erst starten, wenn die Samples da sind (höchstens 2 Sekunden warten), sonst klingt der erste Schlag synthetisch
    if (samplesReady) go(); else Promise.race([loadSamples(), new Promise((ok) => setTimeout(ok, 2000))]).then(go);
  }
  function setTempo(bpm) { P.bpm = bpm; }
  function setMute(list) { P.mute = new Set(list || []); }
  function setTrainer(tr) { P.trainer = tr; }
  // Neuer Bereich während des Spielens: sofort am Anfang des Bereichs weiter
  function setLoop(l) { P.loop = loopOf(P.n, l); if (P.playing) { P.step = 0; P.queue = []; } }
  function stop() { P.token = (P.token || 0) + 1; P.playing = false; clearInterval(P.timer); P.timer = null; if (P.onStep) P.onStep(-1); }
  function schedule() {
    const n = P.n, pb = perBar(n.sig), lf = P.loop ? P.loop.from : 0, steps = P.loop ? (P.loop.to - P.loop.from) * pb : total(n);
    while (P.next < ctx.currentTime + 0.12) {
      const i = lf * pb + (P.step % steps);
      if (P.step % steps === 0 && P.step > 0 && P.trainer) {
        const loops = P.step / steps;
        if (loops % P.trainer.every === 0 && P.bpm < P.trainer.max) {
          P.bpm = Math.min(P.trainer.max, P.bpm + P.trainer.add);
          const b = P.bpm; if (P.onTempo) setTimeout(() => P.onTempo(b), 0);
        }
      }
      const bar = Math.floor(i / pb), src = sourceBar(n, bar) * pb + (i % pb);
      for (const r of ROWS) if (!P.mute.has(r.k) && n.tracks[r.k].includes(src)) {
        if (flamOf(n, r.k, src)) hit(r.k, Math.max(ctx.currentTime + 0.005, P.next - 0.03), 's'); // Vorschlag kurz davor, leise
        hit(r.k, P.next, dynOf(n, r.k, src));
      }
      // Viertel und 16tel Triolen: am Anfang der Gruppe alle Schläge mit genauen Zeiten einplanen
      if (groupSize(n.sig) === 4 && i % 4 === 0) {
        const tp = tupAt(n, Math.floor(src / 4));
        if (tp && tp.g === Math.floor(src / 4)) { const sd = ((60 / P.bpm) * (tp.t === 'q' ? 2 : 1)) / tupSlots(tp); for (const r of ROWS) if (!P.mute.has(r.k)) for (let sl = 0; sl < tupSlots(tp); sl++) if (tupHas(n, r.k, tp.g, sl)) { const t0 = P.next + sl * sd; if (tupFlam(n, r.k, tp.g, sl)) hit(r.k, Math.max(ctx.currentTime + 0.005, t0 - 0.03), 's'); hit(r.k, t0, tupDyn(n, r.k, tp.g, sl)); } }
      }
      if (CLICK.on) {
        const spb = EIGHTH(n.sig) ? 2 : 4, j = i % pb, beats = pb / spb, acc = CLICK.accents && CLICK.accents.length === beats ? CLICK.accents : null;
        const sub = Math.max(1, Math.min(spb, CLICK.sub || 1)), every = sub === 3 ? 0.5 : spb / sub; // 0.5: keine Rasterklicks bei Triolen
        if (j % spb === 0) {
          click(P.next, acc ? acc[j / spb] : (j === 0 ? 2 : 1), CLICK.sound, CLICK.vol);
          // 8tel Triolen: zwei leise Klicks im Drittel und zwei Drittel des Schlags (passt nicht ins 16tel Raster, darum eigene Zeiten)
          if ((CLICK.sub || 1) === 3 && spb === 4) { const beat = 4 * (60 / P.bpm / 4); click(P.next + beat / 3, 0.5, CLICK.sound, CLICK.vol); click(P.next + (2 * beat) / 3, 0.5, CLICK.sound, CLICK.vol); }
        }
        else if (Number.isInteger(every) && j % every === 0 && !isTrip(n, src)) click(P.next, 0.5, CLICK.sound, CLICK.vol);
      }
      P.queue.push({ t: P.next, i });
      P.next += EIGHTH(n.sig) ? 60 / P.bpm / 2 : isTrip(n, src) ? (i % 4 === 3 ? 0 : 60 / P.bpm / 3) : 60 / P.bpm / 4; // Wiederholungstakte spielen die Triolen ihres Vorbilds
      P.step++;
    }
  }
  function draw() {
    if (!P.playing) return;
    let cur = null;
    while (P.queue.length && P.queue[0].t <= ctx.currentTime) cur = P.queue.shift();
    if (cur && P.onStep) P.onStep(cur.i);
    requestAnimationFrame(draw);
  }
  // Cursor in der passenden Notenzeile bewegen
  function cursorFor(root) {
    return (i) => {
      if (!root || !root.isConnected) return;
      root.querySelectorAll('svg.nt-svg').forEach((svg) => {
        const c = svg.querySelector('.nt-cursor'); if (!c) return;
        const from = Number(svg.dataset.from), to = Number(svg.dataset.to);
        if (i < from || i >= to) { c.setAttribute('opacity', '0'); return; }
        c.setAttribute('x', Number(svg.dataset.x0) + (i - from) * Number(svg.dataset.sw) - 2); c.setAttribute('opacity', '.18');
      });
    };
  }
  // Sticking automatisch: alle Schritte mit einem Handschlag (nicht Bassdrum, nicht HiHat Fuß) der Reihe nach mit dem Muster füllen
  function autoStick(n, pattern) {
    n.stick = {}; n.tstick = {}; if (!pattern) return n;
    const hands = ROWS.filter((r) => r.k !== 'bd' && r.k !== 'hf').map((r) => r.k);
    // Zeitposition in Sechzehnteln, damit Triolen Noten in der richtigen Reihenfolge mitgezählt werden
    const ev = [...new Set(hands.flatMap((k) => n.tracks[k] || []))].map((i) => ({ at: isTrip(n, i) ? Math.floor(i / 4) * 4 + (i % 4) * 4 / 3 : i, set: (v) => { n.stick[i] = v; } }));
    for (const tp of n.tup || []) { const w = (tp.t === 'q' ? 8 : 4) / tupSlots(tp); for (let sl = 0; sl < tupSlots(tp); sl++) if (hands.some((k) => tupHas(n, k, tp.g, sl))) ev.push({ at: tp.g * 4 + sl * w, set: (v) => { n.tstick[tp.g + ':' + sl] = v; } }); }
    ev.sort((a, b) => a.at - b.at).forEach((e, j) => e.set(pattern[j % pattern.length]));
    return n;
  }
  const usedKeys = (n) => ROWS.filter((r) => n.tracks[r.k].length || ((n.tupn || {})[r.k] || []).length).map((r) => r.k);

  // ---------- Editor: Takt wählen, Raster für einen Takt ----------
  const EDSEL = {}; // pro Editor: zuletzt angetippter Schlag { k, i }
  const cellText = (n, k, i) => (flamOf(n, k, i) ? 'fl' : '') + (dynOf(n, k, i) === 'a' ? '>' : dynOf(n, k, i) === 's' ? '( )' : '');
  const EDMODE = {}; // pro Editor: '' Note an/aus, 'a' betonen, 's' leise
  function editorHTML(n, id, curBar = 0) {
    const pb = perBar(n.sig), gs = groupSize(n.sig), from = curBar * pb, rep = n.repeat.includes(curBar);
    const lbl = (j) => (isTrip(n, from + j) ? [String(Math.floor(j / 4) + 1), 'ta', 'te', ''][j % 4] : countLabel(n.sig, j));
    const off = (j) => isTrip(n, from + j) && j % 4 === 3;
    // Spalten mit Triolen Gruppen: Viertel und 16tel Triolen fassen 8 bzw. 4 Rasterspalten zu einer Zelle zusammen
    const span = (fn, tupFn) => { const out = []; for (let j = 0; j < pb;) { const tp = gs === 4 && j % 4 === 0 ? tupAt(n, (from + j) / 4) : null; if (tp && tp.g === (from + j) / 4) { const c = tp.t === 'q' ? 8 : 4; out.push(tupFn(tp, j, c)); j += c; continue; } out.push(fn(j)); j++; } return out.join(''); };
    const tupLbl = (tp, j) => { const b = String(j / 4 + 1); return tp.t === 'q' ? [b, 'ta', 'te'] : [b, 'ta', 'te', '+', 'ta', 'te']; };
    const head = `<tr><th scope="col"><span class="nt-sr">Instrument</span></th>${span((j) => `<th scope="col" class="${j % gs === 0 ? 'nt-beat' : ''}">${esc(lbl(j))}</th>`, (tp, j, c) => `<th scope="col" colspan="${c}" class="nt-beat"><div class="nt-tuprow">${tupLbl(tp, j).map((x) => `<span>${x}</span>`).join('')}</div></th>`)}</tr>`;
    const stickRow = `<tr class="nt-stickrow"><th scope="row">Sticking</th>${span((j) => {
      const i = from + j, v = (n.stick || {})[i] || '';
      return `<td class="${Math.floor(j / gs) % 2 ? 'nt-alt' : ''}"><button type="button" class="nt-cell nt-stick" data-nt="${id}" data-k="stick" data-i="${i}" aria-pressed="${!!v}" aria-label="Sticking auf ${esc(lbl(j))}: ${v || 'keins'}" ${rep || off(j) ? 'disabled' : ''}>${v}</button></td>`;
    }, (tp, j, c) => `<td colspan="${c}" class="nt-tupcell"><div class="nt-tuprow">${Array.from({ length: tupSlots(tp) }, (_, sl) => { const v = (n.tstick || {})[tp.g + ':' + sl] || ''; return `<button type="button" class="nt-cell nt-stick" data-nt="${id}" data-k="stick" data-tup="${tp.g}:${sl}" aria-pressed="${!!v}" aria-label="Sticking ${tp.t === 'q' ? 'Viertel' : '16tel'} Triole Note ${sl + 1}: ${v || 'keins'}" ${rep ? 'disabled' : ''}>${v}</button>`; }).join('')}</div></td>`)}</tr>`;
    const rows = stickRow + ROWS.map((r) => `<tr><th scope="row">${r.n}</th>${span((j) => {
      const i = from + j;
      return `<td class="${Math.floor(j / gs) % 2 ? 'nt-alt' : ''}"><button type="button" class="nt-cell${EDSEL[id] && EDSEL[id].k === r.k && EDSEL[id].i === i ? ' nt-sel' : ''}" data-nt="${id}" data-k="${r.k}" data-i="${i}" aria-pressed="${has(n, r.k, i)}" data-dyn="${dynOf(n, r.k, i)}" data-flam="${flamOf(n, r.k, i) ? 1 : ''}" aria-label="${r.n} auf ${esc(lbl(j))}, Takt ${curBar + 1}${dynOf(n, r.k, i) === 'a' ? ', betont' : dynOf(n, r.k, i) === 's' ? ', leise' : ''}${flamOf(n, r.k, i) ? ', Flam' : ''}" ${rep || off(j) ? 'disabled' : ''}>${flamOf(n, r.k, i) ? 'fl' : ''}${dynOf(n, r.k, i) === 'a' ? '&gt;' : dynOf(n, r.k, i) === 's' ? '( )' : ''}</button></td>`;
    }, (tp, j, c) => `<td colspan="${c}" class="nt-tupcell"><div class="nt-tuprow">${Array.from({ length: tupSlots(tp) }, (_, sl) => `<button type="button" class="nt-cell" data-nt="${id}" data-k="${r.k}" data-tup="${tp.g}:${sl}" aria-pressed="${tupHas(n, r.k, tp.g, sl)}" data-dyn="${tupDyn(n, r.k, tp.g, sl)}" data-flam="${tupFlam(n, r.k, tp.g, sl) ? 1 : ''}" aria-label="${r.n}, ${tp.t === 'q' ? 'Viertel' : '16tel'} Triole Note ${sl + 1}${tupDyn(n, r.k, tp.g, sl) === 'a' ? ', betont' : tupDyn(n, r.k, tp.g, sl) === 's' ? ', leise' : ''}${tupFlam(n, r.k, tp.g, sl) ? ', Flam' : ''}" ${rep ? 'disabled' : ''}>${tupFlam(n, r.k, tp.g, sl) ? 'fl' : ''}${tupDyn(n, r.k, tp.g, sl) === 'a' ? '&gt;' : tupDyn(n, r.k, tp.g, sl) === 's' ? '( )' : ''}</button>`).join('')}</div></td>`)}</tr>`).join('');
    const tabs = Array.from({ length: n.bars }, (_, b) => `<button type="button" class="nt-bartab" data-nt-bar="${b}" data-nt-id="${id}" aria-pressed="${b === curBar}">${b + 1}${n.repeat.includes(b) ? ' %' : ''}${n.marks[b] ? ' · ' + esc(n.marks[b]) : ''}</button>`).join('');
    return `<div class="nt-editor" id="${id}" data-bar="${curBar}">
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-sig">Takt</label><select id="${id}-sig" data-nt-ctl="sig">${SIGS.map((g) => `<option ${n.sig === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-bars">Takte</label><select id="${id}-bars" data-nt-ctl="bars">${Array.from({ length: MAX_BARS }, (_, i) => i + 1).map((b) => `<option ${n.bars === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-bpm">Tempo</label><input id="${id}-bpm" data-nt-ctl="bpm" inputmode="numeric" value="${n.bpm}"></div>
      </div>
      <div class="nt-staff">${render(n, { cursor: true, sel: EDSEL[id] })}</div>
      <div class="row"><button type="button" class="btn small primary" data-nt-act="play" data-nt-id="${id}">Abspielen</button><button type="button" class="btn small" data-nt-act="clear" data-nt-id="${id}">Takt leeren</button></div>
      <div class="col" style="gap:6px"><span class="small muted">Sticking: Feld antippen wechselt R, L, K (Fuß), leer. Oder automatisch für alle Handschläge:</span>
        <div class="row" style="gap:6px"><button type="button" class="chip" data-nt-act="stick" data-p="RL" data-nt-id="${id}">R L abwechselnd</button><button type="button" class="chip" data-nt-act="stick" data-p="RRLL" data-nt-id="${id}">R R L L</button><button type="button" class="chip" data-nt-act="stick" data-p="R" data-nt-id="${id}">Alles R</button><button type="button" class="chip" data-nt-act="stick" data-p="" data-nt-id="${id}">Sticking löschen</button></div></div>
      ${n.bars > 1 ? `<div class="nt-bartabs" role="group" aria-label="Takt zum Bearbeiten">${tabs}</div>` : ''}
      <div class="row" style="gap:10px">
        <div class="field" style="flex:2;min-width:150px"><label for="${id}-mark">Teil ab Takt ${curBar + 1}</label><input id="${id}-mark" data-nt-ctl="mark" maxlength="30" placeholder="z. B. Strophe, Refrain" value="${esc(n.marks[curBar] || '')}"></div>
        ${curBar > 0 ? `<label class="row small" style="flex:1;min-width:150px;gap:8px;color:var(--ink)"><input type="checkbox" data-nt-ctl="repeat" style="width:22px;min-height:22px" ${rep ? 'checked' : ''}> Wiederholt den Takt davor</label>` : ''}
      </div>
      ${rep ? '' : `<div class="row" style="gap:6px;align-items:center" role="group" aria-label="Was ein Tipp ins Raster macht"><span class="small muted">Tippen:</span>${[['', 'Note an/aus'], ['a', 'Betont (lauter) >'], ['s', 'Leise ( )'], ['f', 'Flam']].map(([m, l]) => `<button type="button" class="chip" data-nt-act="mode" data-m="${m}" data-nt-id="${id}" aria-pressed="${(EDMODE[id] || '') === m}">${l}</button>`).join('')}</div>`}
      ${rep ? '<p class="small muted">Dieser Takt wiederholt den Takt davor. Haken entfernen, um ihn auszuschreiben.</p>' : `<div class="nt-grid-wrap"><table class="nt-grid">${head}${rows}</table></div>
      ${gs === 4 ? `<div class="row" style="gap:8px;align-items:flex-end" role="group" aria-label="Triolen pro Schlag">${Array.from({ length: pb / 4 }, (_, b) => { const g = curBar * (pb / 4) + b, cur = tupleType(n, g), cov = (tupAt(n, g) || {}).g === g - 1; return `<div class="field" style="flex:1;min-width:110px"><label for="${id}-tp${b}">Schlag ${b + 1}</label><select id="${id}-tp${b}" data-nt-ctl="tup" data-g="${g}" ${cov ? 'disabled' : ''}>${cov ? '<option>Viertel Triole</option>' : [['', 'normal'], ['8', '8tel Triole'], ['16', '16tel Triole'], ...(b < pb / 4 - 1 ? [['q', 'Viertel Triole (2 Schläge)']] : [])].map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; }).join('')}</div>` : ''}`}
    </div>`;
  }

  // Samples schon beim ersten Tippen irgendwo in der App vorladen
  if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => { try { audio(); loadSamples(); } catch (e) { /* ohne Audio */ } }, { once: true, capture: true });
  window.DrumNotation = { tupDyn, tupFlam, tupSetDyn, tupStick, setTrip, isTrip, setTuplet, tupleType, tupToggle, tupHas, tupAt, SIGS, ROWS, MAX_BARS, empty, parse, render, toggle, has, play, stop, setTempo, setMute, setTrainer, setLoop, loop: () => P.loop, hit, editorHTML, cursorFor, total, perBar, setBars, usedKeys, isPlaying: () => P.playing, setDyn, dynOf, flamOf, cellText, select: (id, k, i) => { if (k == null) delete EDSEL[id]; else EDSEL[id] = { k, i }; }, selOf: (id) => EDSEL[id] || null, editMode: (id, m) => { if (m !== undefined) EDMODE[id] = m; return EDMODE[id] || ''; }, resetModes: () => { for (const k of Object.keys(EDMODE)) delete EDMODE[k]; for (const k of Object.keys(EDSEL)) delete EDSEL[k]; }, samplesReady: () => samplesReady, autoStick, audio, click, setClick, loadSamples: () => { audio(); return loadSamples(); } };
})();
