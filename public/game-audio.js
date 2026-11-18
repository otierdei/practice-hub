// Musik und Soundeffekte für die Lernspiele (Otis Wunsch 18.11.2026).
// Alles wird im Browser erzeugt (Web Audio), keine Audiodateien, keine Lizenzfragen.
// Musik: ruhige Schleife, leise. Sobald ein Schlagzeugklang aus dem Spiel kommt (Anhören, Abspielen),
// wird die Musik für ein paar Sekunden ganz leise, damit man genau hinhören kann.
(function () {
  const KEY = 'ph_game_sound';
  let ctx = null, master = null, musicGain = null, sfxGain = null, timer = null, step = 0, nextAt = 0, duckUntil = 0;
  const pref = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { music: true, sfx: true }; } catch (e) { return { music: true, sfx: true }; } };
  const savePref = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };
  function audio() {
    if (ctx) return ctx;
    // gleicher Kontext wie die Schlagzeugklänge, wenn vorhanden (iOS erlaubt nur wenige Kontexte)
    try { ctx = (window.DrumNotation && DrumNotation.audio) ? DrumNotation.audio() : new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
    return ctx;
  }
  function tone(freq, at, dur, type, vol, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(dest); o.start(at); o.stop(at + dur + 0.05);
  }
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // Effekte
  function sfx(kind) {
    if (!pref().sfx || !audio()) return; if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.02;
    if (kind === 'ok') { tone(N(76), t, 0.18, 'triangle', 0.5, sfxGain); tone(N(83), t + 0.09, 0.3, 'triangle', 0.5, sfxGain); }
    else if (kind === 'bad') { tone(N(55), t, 0.22, 'sine', 0.45, sfxGain); tone(N(52), t + 0.12, 0.3, 'sine', 0.45, sfxGain); }
    else if (kind === 'win') { [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.12, i === 3 ? 0.6 : 0.2, 'triangle', 0.5, sfxGain)); }
  }
  // Musik im ruhigen Stil wie bei Minecraft (eigene Komposition, Otis Wunsch 18.11.2026): weiches Klavier mit Hall,
  // langsam (66 BPM), lange Basstöne, wenige Melodietöne aus der Pentatonik, viele Pausen. Jede Runde etwas anders.
  const CH = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 62], [48, 55, 64, 67], [40, 47, 55, 64], [41, 48, 57, 60], [43, 50, 55, 62]];
  const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79];
  const BEAT = 60 / 66;
  let seed = 7, echo = null;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function room() { // Hall: zwei Echos mit Tiefpass
    if (echo) return echo;
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    d1.delayTime.value = 0.37; d2.delayTime.value = 0.53; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 2200; wet.gain.value = 0.45;
    d1.connect(lp); d2.connect(lp); lp.connect(fb); fb.connect(d1); fb.connect(d2); lp.connect(wet); wet.connect(musicGain);
    echo = d1; echo.second = d2; return echo;
  }
  function piano(m, at, len, vol) {
    const f = N(m), g = ctx.createGain(), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), lp = ctx.createBiquadFilter();
    o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * 2; g2.gain.value = 0.18;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(6000, f * 6), at); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), at + len);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.015); g.gain.exponentialRampToValueAtTime(vol * 0.35, at + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g); g.connect(musicGain); const r = room(); g.connect(r); g.connect(r.second);
    o1.start(at); o2.start(at); o1.stop(at + len + 0.05); o2.stop(at + len + 0.05);
  }
  function schedule() {
    if (!ctx) return;
    while (nextAt < ctx.currentTime + 0.5) {
      const bar = Math.floor(step / 8) % CH.length, i = step % 8, ch = CH[bar], half = BEAT / 2;
      if (i === 0) { piano(ch[0] - 12, nextAt, BEAT * 4.5, 0.22); piano(ch[1], nextAt + 0.02, BEAT * 4, 0.1); }
      if (i === 4 && rnd() < 0.6) piano(ch[2], nextAt, BEAT * 3, 0.09);
      if (i === 2 || i === 6) { if (rnd() < 0.35) piano(ch[3], nextAt, BEAT * 2.5, 0.08); }
      if ((i === 1 || i === 3 || i === 5) && rnd() < 0.3) { // Melodie: Ton aus dem Akkord oder der Pentatonik, eine Oktave höher
        const pool = PENTA.filter((p) => ch.some((c) => (c - p) % 12 === 0) || rnd() < 0.3);
        piano(pool[Math.floor(rnd() * pool.length)] + 12, nextAt, BEAT * 2.2, 0.07);
      }
      nextAt += half; step++;
    }
    const target = !pref().music ? 0 : performance.now() < duckUntil ? 0.03 : 0.5;
    musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
  }
  function startMusic() {
    if (!pref().music || !audio() || timer) return; if (ctx.state === 'suspended') ctx.resume();
    nextAt = ctx.currentTime + 0.1; seed = 1 + Math.floor(Math.random() * 1000); timer = setInterval(schedule, 150); schedule();
  }
  function stopMusic() { clearInterval(timer); timer = null; if (musicGain && ctx) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }
  function duck(sec = 3) { duckUntil = Math.max(duckUntil, performance.now() + sec * 1000); if (timer) schedule(); }
  // Schlagzeugklänge des Spiels drücken die Musik automatisch weg
  function hook() {
    const D = window.DrumNotation; if (!D || D.__ga) return; D.__ga = true;
    // Zeitpunkt des Klangs: hit(k, at), click(at, ...). Geplante Takte liegen Sekunden in der Zukunft.
    const wrap = (fn, ti) => { if (typeof D[fn] !== 'function') return; const orig = D[fn]; D[fn] = function () { const at = Number(arguments[ti]); let c = ctx; try { c = c || D.audio(); } catch (e) {} const ahead = c && at > c.currentTime ? at - c.currentTime : 0; duck(ahead + 1.5); return orig.apply(this, arguments); }; };
    wrap('hit', 1); wrap('click', 0);
  }
  function toggle(which) { const p = pref(); p[which] = !p[which]; savePref(p); if (which === 'music') { if (p.music) startMusic(); else stopMusic(); } paint(); }
  // Schalter oben rechts
  function paint() {
    let box = document.getElementById('gaBox');
    if (!box) { box = document.createElement('div'); box.id = 'gaBox'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Ton'); document.body.appendChild(box);
      box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) toggle(b.dataset.ga); }); }
    const p = pref();
    box.innerHTML = `<button type="button" data-ga="music" aria-pressed="${p.music}" title="Musik">${p.music ? '♫' : '♫̸'}<span>Musik</span></button><button type="button" data-ga="sfx" aria-pressed="${p.sfx}" title="Töne bei richtig und falsch">${p.sfx ? '🔔' : '🔕'}<span>Töne</span></button>`;
  }
  const css = document.createElement('style');
  css.textContent = '#gaBox{position:fixed;right:10px;bottom:10px;display:flex;gap:6px;z-index:50}#gaBox button{display:flex;align-items:center;gap:4px;min-height:40px;padding:0 12px;border-radius:999px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.9);font:inherit;font-size:.85rem;cursor:pointer}#gaBox button[aria-pressed=false]{opacity:.55}';
  document.head.appendChild(css);
  // Browser erlauben Ton erst nach dem ersten Antippen
  const first = () => { hook(); startMusic(); document.removeEventListener('pointerdown', first, true); };
  document.addEventListener('pointerdown', first, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(); else if (pref().music && ctx) startMusic(); });
  window.addEventListener('DOMContentLoaded', () => { hook(); paint(); });
  window.GameAudio = { ok: () => sfx('ok'), bad: () => sfx('bad'), win: () => sfx('win'), duck, startMusic, stopMusic, pref, toggle };
})();
