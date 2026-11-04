// Practice Hub Noten Editor für Schlagzeug: Raster, Notenbild (SVG) und Wiedergabe mit Web Audio.
// Ein Beat: { v:1, sig:'4/4'|'6/8', bars:1..4, bpm, tracks:{ cr:[schritte], ... } }, ein Schritt = eine 16tel.
'use strict';
(function () {
  const ROWS = [
    { k: 'cr', n: 'Crash', p: 10, x: true },
    { k: 'rd', n: 'Ride', p: 8, x: true },
    { k: 'hh', n: 'HiHat', p: 9, x: true },
    { k: 'ho', n: 'HiHat offen', p: 9, x: true, open: true },
    { k: 't1', n: 'Tom 1', p: 7 },
    { k: 't2', n: 'Tom 2', p: 6 },
    { k: 'sn', n: 'Snare', p: 5 },
    { k: 'gh', n: 'Ghost Note', p: 5, ghost: true },
    { k: 'ft', n: 'Standtom', p: 3 },
    { k: 'bd', n: 'Bassdrum', p: 1, down: true },
    { k: 'hf', n: 'HiHat Fuß', p: -1, x: true, down: true },
  ];
  const BY = Object.fromEntries(ROWS.map((r) => [r.k, r]));
  const EXCLUSIVE = { hh: 'ho', ho: 'hh', sn: 'gh', gh: 'sn' };
  const perBar = (sig) => (sig === '6/8' ? 12 : 16);
  const groupSize = (sig) => (sig === '6/8' ? 6 : 4);
  const total = (n) => perBar(n.sig) * n.bars;

  function empty(sig = '4/4', bars = 1, bpm = 80) {
    const tracks = {}; ROWS.forEach((r) => { tracks[r.k] = []; });
    return { v: 1, sig, bars, bpm, tracks };
  }
  function parse(s) {
    if (!s) return null;
    try { const o = typeof s === 'string' ? JSON.parse(s) : s; const n = empty(o.sig === '6/8' ? '6/8' : '4/4', Math.min(4, Math.max(1, o.bars | 0 || 1)), o.bpm || 80); ROWS.forEach((r) => { n.tracks[r.k] = (o.tracks && o.tracks[r.k] || []).filter((x) => x >= 0 && x < total(n)); }); return n; }
    catch (e) { return null; }
  }
  function has(n, k, i) { return n.tracks[k].includes(i); }
  function toggle(n, k, i) {
    const t = n.tracks[k];
    if (t.includes(i)) n.tracks[k] = t.filter((x) => x !== i);
    else { t.push(i); t.sort((a, b) => a - b); const ex = EXCLUSIVE[k]; if (ex) n.tracks[ex] = n.tracks[ex].filter((x) => x !== i); }
  }
  function countLabel(sig, i) {
    const pb = perBar(sig), j = i % pb;
    if (sig === '6/8') return j % 2 === 0 ? String(j / 2 + 1) : '+';
    return [String(Math.floor(j / 4) + 1), 'e', '+', 'a'][j % 4];
  }

  // ---------- Notenbild ----------
  const LINE0 = 86; // y der untersten Notenlinie
  const yOf = (p) => LINE0 - p * 5;
  function render(n, opt = {}) {
    if (!n) return '';
    const sw = opt.stepWidth || 22, x0 = 58, steps = total(n), pb = perBar(n.sig), gs = groupSize(n.sig);
    const W = x0 + steps * sw + 14, H = 130;
    const xOf = (i) => x0 + i * sw + 8;
    const out = [];
    const ink = 'currentColor';
    for (let l = 0; l < 5; l++) out.push(`<line x1="6" x2="${W - 6}" y1="${yOf(l * 2)}" y2="${yOf(l * 2)}" stroke="${ink}" stroke-width="1" opacity=".55"/>`);
    // Schlagzeugschlüssel und Taktart
    out.push(`<rect x="12" y="${yOf(6)}" width="4" height="20" fill="${ink}"/><rect x="20" y="${yOf(6)}" width="4" height="20" fill="${ink}"/>`);
    const [a, b] = n.sig.split('/');
    out.push(`<text x="40" y="${yOf(6) + 1}" text-anchor="middle" font-size="19" font-weight="700" font-family="Georgia, serif" fill="${ink}">${a}</text><text x="40" y="${yOf(2) + 1}" text-anchor="middle" font-size="19" font-weight="700" font-family="Georgia, serif" fill="${ink}">${b}</text>`);
    for (let bar = 1; bar <= n.bars; bar++) {
      const bx = x0 + bar * pb * sw - 3;
      out.push(`<line x1="${bx}" x2="${bx}" y1="${yOf(8)}" y2="${yOf(0)}" stroke="${ink}" stroke-width="${bar === n.bars ? 2.5 : 1}"/>`);
    }
    // zwei Stimmen: Hände (Hals oben) und Füße (Hals unten)
    for (const down of [false, true]) {
      const keys = ROWS.filter((r) => !!r.down === down).map((r) => r.k);
      const onsets = [...new Set(keys.flatMap((k) => n.tracks[k]))].sort((x, y) => x - y);
      for (let g = 0; g < steps; g += gs) {
        const inG = onsets.filter((i) => i >= g && i < g + gs);
        if (!inG.length) { if (!down) out.push(restGlyph(n.sig === '6/8' ? 6 : 4, x0 + (g + gs / 2) * sw - 4, ink)); continue; }
        if (!down && inG[0] > g) out.push(restGlyph(inG[0] - g, xOf(g), ink));
        const notes = inG.map((i, idx) => {
          const end = idx + 1 < inG.length ? inG[idx + 1] : g + gs;
          const dur = end - i;
          const hits = keys.filter((k) => n.tracks[k].includes(i)).map((k) => BY[k]);
          const ps = hits.map((h) => h.p);
          return { i, dur, hits, top: Math.max(...ps), bot: Math.min(...ps), beams: dur === 1 ? 2 : dur <= 3 ? 1 : 0, dot: dur === 3 || dur === 6 };
        });
        const sx = (nt) => xOf(nt.i) + (down ? -5.5 : 5.5);
        const tipY = down ? Math.max(...notes.map((nt) => yOf(nt.bot) + 30)) : Math.min(...notes.map((nt) => yOf(nt.top) - 30));
        const beamed = notes.length > 1 && notes.every((nt) => nt.beams > 0);
        for (const nt of notes) {
          for (const h of nt.hits) out.push(head(h, xOf(nt.i), ink));
          if (nt.dot) out.push(`<circle cx="${xOf(nt.i) + 10}" cy="${yOf(nt.top % 2 === 0 ? nt.top + 1 : nt.top)}" r="1.8" fill="${ink}"/>`);
          const from = down ? yOf(nt.top) : yOf(nt.bot);
          const to = beamed ? tipY : (down ? yOf(nt.bot) + 30 : yOf(nt.top) - 30);
          out.push(`<line x1="${sx(nt)}" x2="${sx(nt)}" y1="${from}" y2="${to}" stroke="${ink}" stroke-width="1.3"/>`);
          if (!beamed && nt.beams > 0) for (let f = 0; f < nt.beams; f++) {
            const fy = to + (down ? -f * 7 : f * 7);
            out.push(`<path d="M${sx(nt)} ${fy} q 9 ${down ? -6 : 6} 7 ${down ? -15 : 15}" fill="none" stroke="${ink}" stroke-width="2"/>`);
          }
        }
        if (beamed) {
          const dir = down ? -1 : 1;
          out.push(`<rect x="${sx(notes[0]) - 0.6}" y="${tipY - (down ? 4 : 0)}" width="${sx(notes[notes.length - 1]) - sx(notes[0]) + 1.2}" height="4" fill="${ink}"/>`);
          notes.forEach((nt, idx) => {
            if (nt.beams < 2) return;
            const y2 = tipY + dir * 7 - (down ? 4 : 0);
            const next = notes[idx + 1], prev = notes[idx - 1];
            if (next && next.beams === 2) out.push(`<rect x="${sx(nt) - 0.6}" y="${y2}" width="${sx(next) - sx(nt) + 1.2}" height="4" fill="${ink}"/>`);
            else if (!(prev && prev.beams === 2)) {
              const w = 8, left = next ? sx(nt) : sx(nt) - w;
              out.push(`<rect x="${left - 0.6}" y="${y2}" width="${w + 1.2}" height="4" fill="${ink}"/>`);
            }
          });
        }
      }
    }
    if (opt.cursor) out.push(`<rect class="nt-cursor" x="${x0 - 2}" y="6" width="${sw - 2}" height="${H - 12}" rx="4" fill="var(--ring, #5f6b3a)" opacity="0" />`);
    return `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.label || 'Schlagzeug Noten')}" data-x0="${x0}" data-sw="${sw}">${out.join('')}</svg>`;
  }
  function head(h, x, ink) {
    const y = yOf(h.p), parts = [];
    if (h.p >= 10) parts.push(`<line x1="${x - 9}" x2="${x + 9}" y1="${yOf(10)}" y2="${yOf(10)}" stroke="${ink}" stroke-width="1"/>`);
    if (h.x) parts.push(`<path d="M${x - 4.5} ${y - 4.5} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y - 4.5} L${x - 4.5} ${y + 4.5}" stroke="${ink}" stroke-width="1.8"/>`);
    else parts.push(`<ellipse cx="${x}" cy="${y}" rx="5.6" ry="4" transform="rotate(-20 ${x} ${y})" fill="${ink}"/>`);
    if (h.open) parts.push(`<circle cx="${x}" cy="${yOf(12)}" r="3.4" fill="none" stroke="${ink}" stroke-width="1.4"/>`);
    if (h.ghost) parts.push(`<text x="${x - 11}" y="${y + 4}" font-size="13" fill="${ink}" font-family="Georgia, serif">(</text><text x="${x + 7}" y="${y + 4}" font-size="13" fill="${ink}" font-family="Georgia, serif">)</text>`);
    return parts.join('');
  }
  function restGlyph(steps, x, ink) {
    const y = yOf(4);
    if (steps >= 4) { // Viertelpause (bei 6/8 mit Punkt)
      return `<path d="M${x + 1} ${y - 14} l6 7 l-5 6 l6 7 c-5 -2 -8 1 -4 6" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` + (steps === 6 ? `<circle cx="${x + 12}" cy="${y - 2}" r="1.8" fill="${ink}"/>` : '');
    }
    const flags = steps === 1 ? 2 : 1;
    let d = '';
    for (let f = 0; f < flags; f++) d += `<circle cx="${x + 1 - f * 2}" cy="${y - 6 + f * 7}" r="2.6" fill="${ink}"/><path d="M${x + 2 - f * 2} ${y - 5 + f * 7} q4 1 6 -3" stroke="${ink}" stroke-width="1.5" fill="none"/>`;
    return d + `<line x1="${x + 8}" y1="${y - 8}" x2="${x + 2 - (flags - 1) * 3}" y2="${y + 10 + (flags - 1) * 5}" stroke="${ink}" stroke-width="1.5"/>` + (steps === 3 ? `<circle cx="${x + 12}" cy="${y - 6}" r="1.8" fill="${ink}"/>` : '');
  }
  function esc(v) { return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
    gh: (t) => { noise(t, 0.07, 0.12, 'highpass', 1800); },
    hh: (t) => noise(t, 0.04, 0.25, 'highpass', 7500),
    ho: (t) => noise(t, 0.32, 0.22, 'highpass', 7000),
    hf: (t) => noise(t, 0.05, 0.18, 'bandpass', 6000),
    rd: (t) => { noise(t, 0.45, 0.12, 'bandpass', 5500); tone(t, 620, 600, 0.3, 0.05); },
    cr: (t) => noise(t, 1.1, 0.3, 'highpass', 4500),
    t1: (t) => tone(t, 260, 190, 0.22, 0.6),
    t2: (t) => tone(t, 200, 140, 0.25, 0.6),
    ft: (t) => tone(t, 130, 85, 0.35, 0.7),
  };
  function hit(k, t) { audio(); (SOUND[k] || SOUND.sn)(t || ctx.currentTime + 0.01); }

  // Wiedergabe in Schleife mit Vorausplanung
  const P = { playing: false, timer: null, next: 0, step: 0, n: null, bpm: 80, queue: [], onStep: null };
  function play(n, bpm, onStep) {
    stop(); audio();
    P.n = n; P.bpm = bpm || n.bpm || 80; P.onStep = onStep; P.playing = true; P.step = 0; P.next = ctx.currentTime + 0.08; P.queue = [];
    P.timer = setInterval(schedule, 25); requestAnimationFrame(draw);
  }
  function setTempo(bpm) { P.bpm = bpm; }
  function stop() { P.playing = false; clearInterval(P.timer); P.timer = null; if (P.onStep) P.onStep(-1); }
  function schedule() {
    const n = P.n, steps = total(n);
    // 4/4: Viertel = 4 Schritte; 6/8: Achtel = 2 Schritte, Tempo in Achteln
    const stepDur = n.sig === '6/8' ? 60 / P.bpm / 2 : 60 / P.bpm / 4;
    while (P.next < ctx.currentTime + 0.12) {
      const i = P.step % steps;
      for (const r of ROWS) if (n.tracks[r.k].includes(i)) hit(r.k, P.next);
      P.queue.push({ t: P.next, i });
      P.next += stepDur; P.step++;
    }
  }
  function draw() {
    if (!P.playing) return;
    let cur = null;
    while (P.queue.length && P.queue[0].t <= ctx.currentTime) cur = P.queue.shift();
    if (cur && P.onStep) P.onStep(cur.i);
    requestAnimationFrame(draw);
  }
  // Cursor im Notenbild bewegen
  function cursorFor(svg) {
    return (i) => {
      if (!svg || !svg.isConnected) return;
      const c = svg.querySelector('.nt-cursor'); if (!c) return;
      if (i < 0) { c.setAttribute('opacity', '0'); return; }
      c.setAttribute('x', Number(svg.dataset.x0) + i * Number(svg.dataset.sw) - 2); c.setAttribute('opacity', '.18');
    };
  }

  // ---------- Editor ----------
  function editorHTML(n, id) {
    const steps = total(n), pb = perBar(n.sig), gs = groupSize(n.sig);
    const head = `<tr><th scope="col"><span class="nt-sr">Instrument</span></th>${Array.from({ length: steps }, (_, i) => `<th scope="col" class="${i % pb === 0 && i ? 'nt-bar' : ''}${i % gs === 0 ? ' nt-beat' : ''}">${countLabel(n.sig, i)}</th>`).join('')}</tr>`;
    const rows = ROWS.map((r) => `<tr><th scope="row">${r.n}</th>${Array.from({ length: steps }, (_, i) =>
      `<td class="${i % pb === 0 && i ? 'nt-bar' : ''}${Math.floor(i / gs) % 2 ? ' nt-alt' : ''}"><button type="button" class="nt-cell" data-nt="${id}" data-k="${r.k}" data-i="${i}" aria-pressed="${has(n, r.k, i)}" aria-label="${r.n} auf ${countLabel(n.sig, i)}, Schritt ${i + 1}"></button></td>`).join('')}</tr>`).join('');
    return `<div class="nt-editor" id="${id}">
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-sig">Takt</label><select id="${id}-sig" data-nt-ctl="sig"><option ${n.sig === '4/4' ? 'selected' : ''}>4/4</option><option ${n.sig === '6/8' ? 'selected' : ''}>6/8</option></select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-bars">Takte</label><select id="${id}-bars" data-nt-ctl="bars">${[1, 2, 3, 4].map((b) => `<option ${n.bars === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:90px"><label for="${id}-bpm">Tempo</label><input id="${id}-bpm" data-nt-ctl="bpm" inputmode="numeric" value="${n.bpm}"></div>
      </div>
      <div class="nt-staff">${render(n, { cursor: true })}</div>
      <div class="row"><button type="button" class="btn small primary" data-nt-act="play" data-nt-id="${id}">Abspielen</button><button type="button" class="btn small" data-nt-act="clear" data-nt-id="${id}">Leeren</button><span class="small muted">Tippe ins Raster, um Schläge zu setzen.</span></div>
      <div class="nt-grid-wrap"><table class="nt-grid">${head}${rows}</table></div>
    </div>`;
  }

  window.DrumNotation = { ROWS, empty, parse, render, toggle, has, play, stop, setTempo, hit, editorHTML, cursorFor, total, isPlaying: () => P.playing };
})();
