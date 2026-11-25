// Spielzeit in Lernspielen (25.11.2026): zählt aktive Zeit und meldet sie als eigenes Zeitkontingent, getrennt von der Übezeit.
// Aktiv heißt: Seite sichtbar und in den letzten 90 Sekunden getippt, geklickt oder eine Taste gedrückt.
'use strict';
(function () {
  const GAME = { notenspiel: 'noten', notenwerte: 'werte', hoerspiel: 'hoeren', taktspiel: 'takt', songform: 'form' }[(location.pathname.split('/').pop() || '').replace(/\.html$/, '')];
  if (!GAME) return;
  const IDLE = 90000;
  let last = Date.now(), pending = 0;
  const token = () => { try { const t = JSON.parse(localStorage.getItem('ph_token') || 'null'), r = JSON.parse(localStorage.getItem('ph_role') || 'null'); return t && r === 'student' ? t : null; } catch (e) { return null; } };
  const day = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { last = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - last < IDLE) pending++; }, 1000);
  function flush(keepalive) {
    const t = token(), add = Math.min(600, pending); if (!t || add < 5) return;
    pending -= add;
    fetch('/api/my/game', { method: 'POST', keepalive: !!keepalive, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ game: GAME, add_seconds: add, local_date: day() }) })
      .catch(() => { pending += add; });
  }
  setInterval(() => flush(false), 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));
})();
