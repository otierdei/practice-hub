// Notenbild per Claude API in einen oder mehrere Beats für den Noten Editor übertragen.
// Ohne Schlüssel: Cloudflare Workers AI (kostenlos im Tageskontingent). Mit Secret ANTHROPIC_API_KEY: Claude.
const PROMPT = `Du liest Schlagzeugnoten von einem Bild und überträgst sie in JSON für einen Noteneditor.

Raster: Jeder Takt hat Schritte von 16teln. 4/4 = 16 Schritte pro Takt (1 e & a 2 e & a ...), 3/4 = 12, 6/8 = 12 (Achtel = 2 Schritte), 12/8 = 24.
Schritte werden über alle Takte durchgezählt: Takt 2 beginnt im 4/4 bei Schritt 16.
Instrumente (Schlüssel in "tracks"): cr Crash, rd Ride, hh HiHat geschlossen, ho HiHat offen, t1 Tom 1, t2 Tom 2, sn Snare, gh Ghost Note (Snare in Klammern), ft Standtom, bd Bassdrum, hf HiHat mit dem Fuß.
Übliche Lage im Notensystem: Kreuz über der obersten Linie = HiHat, Kreuz mit Kreis oder "o" = HiHat offen, Kreuz auf der obersten Linie = Ride, Kreuz über dem System mit Hilfslinie = Crash, dritter Zwischenraum von unten = Snare, Kopf im untersten Zwischenraum = Bassdrum, oberste Zwischenräume = Toms, zweiter Zwischenraum von unten = Standtom, Kreuz unter dem System = HiHat Fuß.
Stehen Handsätze (R, L) unter den Noten, trage sie in "stick" ein: {"Schritt": "R"|"L"}.
Sind auf dem Bild mehrere nummerierte Beispiele, gib jedes als eigenen Beat zurück, in der Reihenfolge des Bildes.
Ein Beispiel mit mehreren Takten wird ein Beat mit "bars" > 1 (höchstens 16).
Lässt sich etwas nicht im 16tel Raster darstellen (z. B. Triolen in 4/4, Flams, Wirbel), nähere es an und schreibe es kurz auf Deutsch in "hinweis".

Antworte nur mit JSON in genau dieser Form, ohne weiteren Text:
{"beats":[{"title":"Beispiel 1","sig":"4/4","bars":1,"bpm":null,"tracks":{"hh":[0,2,4,6,8,10,12,14],"sn":[4,12],"bd":[0,8]},"stick":{}}],"hinweis":""}
Wenn auf dem Bild keine Schlagzeugnoten sind: {"beats":[],"hinweis":"Keine Schlagzeugnoten erkannt."}`;

const CF_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// Claude, wenn ein Schlüssel hinterlegt ist, sonst kostenlos Cloudflare Workers AI
async function askClaude(env, mediaType, data, HttpError) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('anthropic', res.status, err.slice(0, 300));
    if (res.status === 401) throw new HttpError(502, 'Der API Schlüssel wurde abgelehnt. Bitte in Cloudflare prüfen.');
    if (res.status === 429) throw new HttpError(502, 'Zu viele Anfragen gerade. Bitte gleich nochmal.');
    throw new HttpError(502, 'Die Transkription hat nicht geklappt. Bitte nochmal versuchen.');
  }
  const out = await res.json();
  return (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}
async function askCloudflare(env, mediaType, data, HttpError) {
  const input = { messages: [{ role: 'user', content: PROMPT }], image: `data:${mediaType};base64,${data}`, max_tokens: 2048, temperature: 0 };
  let out;
  try { out = await env.AI.run(CF_MODEL, input); }
  catch (e) {
    // Einmalig Metas Lizenz für das Modell bestätigen, dann nochmal
    if (!/agree|licen/i.test(String(e && e.message))) { console.error('workers-ai', e); throw new HttpError(502, 'Die kostenlose Transkription hat nicht geklappt. Bitte nochmal versuchen.'); }
    await env.AI.run(CF_MODEL, { prompt: 'agree' }).catch(() => {});
    out = await env.AI.run(CF_MODEL, input);
  }
  return String((out && (out.response ?? (out.result && out.result.response))) || '');
}

export async function transcribeImage(env, body, clean, HttpError) {
  if (!env.ANTHROPIC_API_KEY && !env.AI) throw new HttpError(503, 'Transkription ist noch nicht eingerichtet.');
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'Bitte ein Bild als JPG, PNG oder WebP hochladen.');
  if (m[2].length > 2800000) throw new HttpError(413, 'Das Bild ist zu groß.');
  const text = env.ANTHROPIC_API_KEY ? await askClaude(env, m[1], m[2], HttpError) : await askCloudflare(env, m[1], m[2], HttpError);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  let parsed;
  try { parsed = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new HttpError(502, 'Die Noten konnten nicht gelesen werden. Bitte ein schärferes Bild versuchen.'); }
  const beats = [];
  for (const [i, x] of (Array.isArray(parsed.beats) ? parsed.beats : []).slice(0, 12).entries()) {
    try { beats.push({ title: String(x.title || 'Beispiel ' + (i + 1)).slice(0, 60), notation: JSON.parse(clean({ ...x, bpm: x.bpm || 45 })) }); } catch (e) { /* kaputtes Beispiel überspringen */ }
  }
  return { beats, hinweis: String(parsed.hinweis || '').slice(0, 300), engine: env.ANTHROPIC_API_KEY ? 'claude' : 'cloudflare' };
}
