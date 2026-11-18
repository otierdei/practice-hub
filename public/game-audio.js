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
  // Musik: vier Akkorde (C, Am, F, G), weiches Arpeggio und Bass, 92 BPM
  const CH = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], SPB = 60 / 92 / 2;
  function schedule() {
    if (!ctx) return;
    while (nextAt < ctx.currentTime + 0.4) {
      const bar = Math.floor(step / 8) % 4, i = step % 8, ch = CH[bar];
      if (i === 0) tone(N(ch[0] - 24), nextAt, SPB * 7, 'sine', 0.35, musicGain);
      tone(N(ch[[0, 1, 2, 1, 0, 2, 1, 2][i]] + 12), nextAt, SPB * 1.6, 'triangle', 0.12, musicGain);
      nextAt += SPB; step++;
    }
    const target = !pref().music ? 0 : performance.now() < duckUntil ? 0.02 : 0.18;
    musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  }
  function startMusic() {
    if (!pref().music || !audio() || timer) return; if (ctx.state === 'suspended') ctx.resume();
    nextAt = ctx.currentTime + 0.1; timer = setInterval(schedule, 120); schedule();
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
