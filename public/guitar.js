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
    try { const o = typeof s === 'string' ? JSON.parse(s) : s; if (o.kind !== 'guitar') return null; const e = empty(); return { ...e, ...o, strum: { ...e.strum, ...(o.strum || {}) }, tab: { ...e.tab, ...(o.tab || {}) }, chords: o.chords || [] }; } catch (e) { return null; }
  }
  const strumLen = (g) => g.strum.sub * g.strum.bars;

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
  function audio() { ctx = ctx || (window.__phAudio = window.__phAudio || new (window.AudioContext || window.webkitAudioContext)()); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  function pluck(freq, t, dur = 1.2, peak = 0.18) {
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
  function play(g, mode, bpm, onStep, onChord) {
    stop(); audio();
    Object.assign(P, { g, mode, bpm: bpm || g.bpm, onStep, onChord, playing: true, step: 0, queue: [] });
    P.next = ctx.currentTime + 0.08; P.timer = setInterval(schedule, 25); requestAnimationFrame(draw);
  }
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
      } else {
        const n = g.tab.bars * 16; i = P.step % n;
        for (const [s, step, fret] of g.tab.notes) if (step === i) pluck(fretFreq(s, fret, g.capo || 0), P.next, 0.9, 0.2);
        dur = 60 / P.bpm / 4;
      }
      P.queue.push({ t: P.next, i, chord }); P.next += dur; P.step++;
    }
  }
  function draw() {
    if (!P.playing) return;
    let cur = null; while (P.queue.length && P.queue[0].t <= ctx.currentTime) cur = P.queue.shift();
    if (cur) { if (P.onStep) P.onStep(cur.i); if (cur.chord && P.onChord) P.onChord(cur.chord); }
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
  const T = { stream: null, raf: 0, analyser: null, buf: null };
  function autoCorrelate(buf, rate) {
    let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length); if (rms < 0.012) return -1;
    let r1 = 0, r2 = buf.length - 1; const th = 0.2;
    for (let i = 0; i < buf.length / 2; i++) if (Math.abs(buf[i]) < th) { r1 = i; break; }
    for (let i = 1; i < buf.length / 2; i++) if (Math.abs(buf[buf.length - i]) < th) { r2 = buf.length - i; break; }
    const b = buf.slice(r1, r2), n = b.length, c = new Float32Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) c[i] += b[j] * b[j + i];
    let d = 0; while (d < n - 1 && c[d] > c[d + 1]) d++;
    let max = -1, pos = -1; for (let i = d; i < n; i++) if (c[i] > max) { max = c[i]; pos = i; }
    if (pos < 1 || pos >= n - 1) return -1;
    const x1 = c[pos - 1], x2 = c[pos], x3 = c[pos + 1], a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
    return rate / (a ? pos - bb / (2 * a) : pos);
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
    const loop = () => {
      T.analyser.getFloatTimeDomainData(T.buf);
      const f = autoCorrelate(T.buf, ctx.sampleRate);
      if (f > 60 && f < 1200) {
        const nearest = OPEN.reduce((best, o, s) => (Math.abs(Math.log2(f / o)) < Math.abs(Math.log2(f / OPEN[best])) ? s : best), 0);
        onReading({ freq: f, ...noteOf(f), string: nearest });
      }
      T.raf = requestAnimationFrame(loop);
    };
    loop();
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
      <h4 class="gt-h">Tabs</h4>
      <div class="row" style="gap:10px"><div class="field" style="flex:1;max-width:160px"><label for="${id}-tbars">Takte</label><select id="${id}-tbars" data-gt-ctl="tbars">${[1, 2, 3, 4].map((b) => `<option ${g.tab.bars === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div></div>
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
      ${g.strum.cells.some(Boolean) ? `<div class="gt-strumwrap">${strumSVG(g, { cursor: true })}</div>` : ''}
      ${g.tab.notes.length ? `<div class="gt-tabwrap">${tabSVG(g, { cursor: true })}</div>` : ''}
    </div>`;
  }
  const cycle = (c) => ({ '': 'D', D: 'U', U: 'X', X: '' }[c || '']);

  window.Guitar = { CHORDS, empty, parse, chordSVG, strumSVG, tabSVG, editorHTML, viewHTML, tunerHTML, tunerStart, tunerStop, play, stop, setTempo, cursorFor, capoTable, soundingKey, cycle, isPlaying: () => P.playing, NOTES_INT, label, strum: (n, d) => { audio(); strum(n, d, ctx.currentTime + 0.01, 0); } };
})();
