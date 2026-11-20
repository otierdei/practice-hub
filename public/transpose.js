// Practice Hub Transpose für YouTube Videos am Laptop (Otis Wunsch 19.11.2026).
// Der eingebettete YouTube Player gibt seinen Ton nicht heraus. Deshalb holt Chrome nach einer Freigabe den Ton des eigenen Tabs
// (getDisplayMedia, nur dieser Tab), schaltet die normale Wiedergabe stumm (suppressLocalAudioPlayback) und spielt ihn
// über einen Tonhöhen Verschieber neu ab. Tempo bleibt gleich. Geht nicht am iPhone (Safari kann keinen Tab Ton teilen).
'use strict';
(function () {
  // Tonhöhe ohne Tempo: zwei Leseköpfe auf einer Verzögerungslinie, die gegeneinander versetzt laufen und sich überblenden
  const WORKLET = `
  class PhShift extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2 }]; }
    constructor() { super(); this.N = 16384; this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.p = 0; this.W = Math.round(sampleRate * 0.07); }
    read(b, d) { const N = this.N; let x = this.w - d - 1; while (x < 0) x += N; const i = Math.floor(x), f = x - i; return b[i % N] * (1 - f) + b[(i + 1) % N] * f; }
    process(inputs, outputs, params) {
      const inp = inputs[0], out = outputs[0]; if (!out.length) return true;
      const r = params.ratio[0], W = this.W, step = (1 - r) / W, n = out[0].length;
      for (let k = 0; k < n; k++) {
        for (let c = 0; c < out.length; c++) { const src = inp[c] || inp[0]; this.buf[c % 2][this.w] = src ? src[k] : 0; }
        const p1 = this.p, p2 = (this.p + 0.5) % 1, g1 = 1 - Math.abs(2 * p1 - 1), g2 = 1 - Math.abs(2 * p2 - 1);
        for (let c = 0; c < out.length; c++) { const b = this.buf[c % 2]; out[c][k] = r === 1 ? b[this.w] : this.read(b, p1 * W) * g1 + this.read(b, p2 * W) * g2; }
        this.w = (this.w + 1) % this.N; this.p += step; if (this.p >= 1) this.p -= 1; if (this.p < 0) this.p += 1;
      }
      return true;
    }
  }
  registerProcessor('ph-shift', PhShift);`;

  const T = { semi: 0, on: false, ctx: null, node: null, stream: null, onChange: null };
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.AudioWorkletNode) && !isIOS();
  const ratio = () => Math.pow(2, T.semi / 12);
  const changed = () => { if (T.onChange) T.onChange(); };

  async function start() {
    if (T.on) return true;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 320, height: 180, frameRate: 1 },
      audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
    });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach((t) => t.stop()); throw new Error('noaudio'); }
    const ctx = T.ctx || (T.ctx = new AudioContext());
    if (!T.loaded) { const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })); await ctx.audioWorklet.addModule(url); T.loaded = true; }
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const node = new AudioWorkletNode(ctx, 'ph-shift', { outputChannelCount: [2] });
    node.parameters.get('ratio').value = ratio();
    src.connect(node).connect(ctx.destination);
    Object.assign(T, { on: true, node, src, stream });
    stream.getTracks().forEach((t) => t.addEventListener('ended', stop));
    changed(); return true;
  }
  function stop() {
    if (T.stream) T.stream.getTracks().forEach((t) => t.stop());
    try { if (T.src) T.src.disconnect(); if (T.node) T.node.disconnect(); } catch (e) { /* schon getrennt */ }
    Object.assign(T, { on: false, node: null, src: null, stream: null }); changed();
  }
  function setSemi(s) { T.semi = Math.max(-6, Math.min(6, Math.round(s))); if (T.node) T.node.parameters.get('ratio').setTargetAtTime(ratio(), T.ctx.currentTime, 0.02); changed(); }

  window.PhTranspose = { supported, start, stop, setSemi, semi: () => T.semi, isOn: () => T.on, onChange: (f) => { T.onChange = f; } };
})();
