// Nur für lokale Tests: tut so, als hätte Claude ein Notenbild mit zwei Beispielen gelesen
const real = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = new URL(typeof u === 'string' ? u : u.url);
  if (url.hostname !== 'api.anthropic.com') return real(u, o);
  const beats = [{ title: 'Beispiel 1', sig: '4/4', bars: 1, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14], sn: [4, 12], bd: [0, 8] } },
    { title: 'Beispiel 2', sig: '4/4', bars: 1, tracks: { hh: [0, 2, 4, 6, 8, 10, 12, 14], sn: [4, 12], bd: [0, 10] } }];
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ beats, hinweis: '' }) }] }), { status: 200 });
};
