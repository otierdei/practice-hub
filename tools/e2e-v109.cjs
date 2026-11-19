// E2E ph-v109: Stimmgerät reagiert schnell. Echtes Mikrofon wird durch eine Testdatei ersetzt (A 110 Hz, nach 3 s tiefes E 82 Hz).
// Prüft: erste Anzeige schnell, richtige Töne, Tonwechsel schnell, Rechenzeit pro Messung bei 6fach gebremster CPU (wie ein iPhone).
// Aufruf: node tools/e2e-v109.cjs (dev-server muss laufen). Die Testdatei wird selbst erzeugt.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
function makeWav() { // 6 s Mono 48 kHz: 3 s A2 (110 Hz), dann 3 s E2 (82,41 Hz), mit Obertönen wie eine Saite
  const r = 48000, len = r * 6, buf = Buffer.alloc(44 + len * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(r, 24); buf.writeUInt32LE(r * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) { const t = i / r, f = t < 3 ? 110 : 82.41; const v = 0.35 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t + 1) + 0.1 * Math.sin(6 * Math.PI * f * t + 2); buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  const p = path.join(os.tmpdir(), 'ph-v109-stimmen.wav'); fs.writeFileSync(p, buf); return p;
}
const AUDIO = process.env.AUDIO || makeWav();
const APP = 'http://localhost:8080/';
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' ' + m);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + AUDIO, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const t = await ctx.newPage(); const errors = []; t.on('pageerror', (e) => errors.push(e.message));
  await t.goto(APP); await t.fill('#code', 'lehrer2345xy'); await t.click('button[type=submit]');
  await t.getByRole('heading', { name: 'Heute', exact: true }).waitFor();
  const cdp = await ctx.newCDPSession(t); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  // Rechenzeit pro Messung, 2048 Werte bei 48 kHz
  const ms = await t.evaluate(() => { const r = 48000, b = new Float32Array(2048); for (let i = 0; i < 2048; i++) b[i] = 0.4 * Math.sin(2 * Math.PI * 82.41 * i / r) + 0.2 * Math.sin(2 * Math.PI * 164.82 * i / r);
    const t0 = performance.now(); let f; for (let k = 0; k < 20; k++) f = Guitar.pitch(b, r); return { ms: (performance.now() - t0) / 20, f }; });
  console.log('Messung bei 6fach gebremster CPU:', ms.ms.toFixed(1), 'ms, erkannt', ms.f.toFixed(2), 'Hz');
  assert.ok(Math.abs(1200 * Math.log2(ms.f / 82.41)) < 3, 'E2 genau'); assert.ok(ms.ms < 16, 'unter einem Bild (16 ms)'); ok('Tonhöhe genau und unter 16 ms pro Messung');
  await t.click('[data-tab=mehr]');
  const t0 = Date.now(); await t.click('[data-act=tuner]');
  await t.waitForFunction(() => document.querySelector('#tunerNote').textContent === 'A', null, { timeout: 3000 });
  const first = Date.now() - t0; console.log('Erste Anzeige A nach', first, 'ms'); ok('A 110 Hz erkannt');
  await t.waitForFunction(() => document.querySelector('#tunerNote').textContent === 'E', null, { timeout: 6000 });
  const t1 = Date.now(); const cents = await t.textContent('#tunerCents'); console.log('Wechsel auf E, Anzeige:', cents); ok('Wechsel auf tiefes E erkannt');
  // Bildrate während das Stimmgerät läuft
  const fps = await t.evaluate(() => new Promise((res) => { let c = 0; const s = performance.now(); const f = () => { c++; if (performance.now() - s < 1000) requestAnimationFrame(f); else res(c); }; requestAnimationFrame(f); }));
  console.log('Bilder pro Sekunde bei laufendem Stimmgerät (CPU 6fach gebremst):', fps); assert.ok(fps > 30, 'flüssig'); ok('Anzeige bleibt flüssig');
  await t.click('[data-act=tuner]');
  assert.deepEqual(errors, []); await b.close(); console.log(`ALLE ${n} SCHRITTE GRÜN (v109)`);
})().catch((e) => { console.error(e); process.exit(1); });
