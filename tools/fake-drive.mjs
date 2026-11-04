// Nur für lokale Tests ohne Internet: tut so, als wäre der Lieder Ordner in Drive erreichbar
import { LIEDER_ROOT } from '../worker/src/songs.js';
const e = (id, name, folder) => `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/${folder ? 'drive/folders/' : 'file/d/'}${id}"><div class="flip-entry-title">${name}</div></a></div>`;
const de = ['Der Sieg gehört dir allein - A - 81', 'Der Sieg gehört dir allein - G', 'Gott der Wunder - E', 'Gott der Erweckung - A', 'Ewig treuer Gott - A 100', 'Schaffe Raum-A', 'Tempel-A', 'Dir gehört mein Lob - A', 'Alle Schöpfung staunt - A', 'Aus tiefstem Herzen - A'];
const en = ['A Thousand Hallelujahs', 'Alive - C', 'All Day-B 122', 'All For Love-D', 'All I Need Is You-E', 'All My Fountains-E', 'All To Us-C'];
const sun = ['1. Der Sieg gehört dir allein - A - 81', '2. Gott der Wunder - E', '3. Gott der Erweckung - A', '4. Ewig treuer Gott - A 100', '5. Schaffe Raum-A', '6. Dir gehört mein Lob - A'];
const next = new Date(); next.setDate(next.getDate() + ((7 - next.getDay()) % 7 || 7));
const dn = `${String(next.getDate()).padStart(2, '0')}.${String(next.getMonth() + 1).padStart(2, '0')}.${next.getFullYear()}`;
const D = {
  [LIEDER_ROOT]: e('de', 'Deutsch', 1) + e('en', 'English', 1) + e('sets', 'Lieder sets', 1),
  de: de.map((n, i) => e('d' + i, n + '.pdf')).join(''),
  en: en.map((n, i) => e('e' + i, n + '.pdf')).join(''),
  sets: e('s1', 'Sonntag, ' + dn, 1),
  s1: sun.map((n, i) => e('s1f' + i, n + '.pdf')).join(''),
};
const real = globalThis.fetch;
globalThis.fetch = async (u, o) => { const url = new URL(typeof u === 'string' ? u : u.url); if (url.hostname === 'drive.google.com') { const id = url.searchParams.get('id'); return new Response(D[id] || '', { status: D[id] ? 200 : 404 }); } return real(u, o); };
