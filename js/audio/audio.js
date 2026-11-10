// Audio core: one AudioContext, buses (music / sfx / voice / ambience), a generated
// convolution reverb, and spatial helpers. Everything is synthesized; no samples needed
// except the public-domain recordings used in documentary interludes.

export class AudioEngine {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;
    this.ready = false;
    this.listener = { x: 0, y: 0, zoom: 22 };
  }

  // Must be called from a user gesture (iOS requirement).
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.9;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.bus = {};
    for (const name of ['music', 'sfx', 'voice', 'amb']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.bus[name] = g;
    }
    this.applyVolumes();
    // A short silent buffer fully unlocks iOS audio.
    const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    this.noiseBuf = this.makeNoise(2);
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master ?? 0.9, t, 0.05);
    this.bus.music.gain.setTargetAtTime((s.music ?? 0.7) * 0.8, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(s.sfx ?? 0.85, t, 0.05);
    this.bus.voice.gain.setTargetAtTime(s.voice ?? 0.9, t, 0.05);
    this.bus.amb.gain.setTargetAtTime((s.sfx ?? 0.85) * 0.6, t, 0.05);
  }

  impulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Early reflections then a smooth diffuse tail.
        const early = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * (ch ? 0.97 : 1);
      }
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Spatial: volume falls off with distance from the camera; pan follows screen side.
  spatial(x, y) {
    if (x === undefined) return { vol: 1, pan: 0 };
    const L = this.listener;
    const dx = x - L.x, dy = y - L.y;
    const d = Math.hypot(dx, dy);
    const reach = L.zoom * 1.4 + 6;
    const vol = Math.max(0, 1 - d / reach) ** 1.4;
    // Project onto the screen's horizontal axis.
    const sx = dx * Math.cos(L.yaw || 0.785) - dy * Math.sin(L.yaw || 0.785);
    const pan = Math.max(-0.85, Math.min(0.85, sx / (L.zoom * 0.9)));
    return { vol, pan };
  }

  // Build a voice chain: source -> filter? -> gain -> panner -> bus (+ reverb send).
  out(bus = 'sfx', { vol = 1, pan = 0, wet = 0.15 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = vol;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.bus[bus]); } else g.connect(this.bus[bus]);
    if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.reverb); }
    return g;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }
}
