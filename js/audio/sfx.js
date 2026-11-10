// Synthesized sound effects and ambiences.

export class Sfx {
  constructor(engine) { this.a = engine; this.amb = []; this.lastPlayed = {}; }

  get ctx() { return this.a.ctx; }

  noise(dest, t, dur, { type = 'lowpass', f = 1200, q = 0.7, f2, gain = 1, attack = 0.002, curve = 'exp' } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.a.noiseBuf;
    s.loopStart = Math.random(); s.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur); else g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(flt); flt.connect(g); g.connect(dest);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return g;
  }
  tone(dest, t, dur, { f = 440, f2, type = 'sine', gain = 0.5, attack = 0.005, decay } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (decay || dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // Play a named effect, optionally at a world position.
  play(name, x, y, opts = {}) {
    if (!this.a.ready) return;
    const now = this.ctx.currentTime;
    // Rate-limit identical sounds so mass events don't clip.
    if (this.lastPlayed[name] && now - this.lastPlayed[name] < (opts.gap ?? 0.03)) return;
    this.lastPlayed[name] = now;
    const fn = SOUNDS[name];
    if (!fn) return;
    // Aircraft and thunder fill the whole sky: they ignore distance and do their own panning.
    const global = GLOBAL[name];
    const sp = global ? { vol: global, pan: 0 } : this.a.spatial(x, y);
    if (sp.vol < 0.02 && !opts.ui) return;
    const out = this.a.out(opts.bus || 'sfx', { vol: sp.vol * (opts.vol ?? 1), pan: sp.pan, wet: opts.wet ?? (global ? 0.3 : 0.18) });
    fn(this, out, now + (opts.delay || 0), { ...opts, x, y });
  }

  // ---------- ambience ----------
  startAmbience(kinds) {
    this.stopAmbience();
    if (!this.a.ready) return;
    for (const k of kinds) {
      const fn = AMBIENCE[k];
      if (fn) this.amb.push(fn(this));
    }
  }
  stopAmbience() {
    for (const a of this.amb) a && a.stop && a.stop();
    this.amb = [];
  }
}

const SOUNDS = {
  click(s, o, t) { s.tone(o, t, 0.05, { f: 1800, type: 'square', gain: 0.08 }); },
  hover(s, o, t) { s.tone(o, t, 0.04, { f: 2600, type: 'sine', gain: 0.03 }); },
  type(s, o, t) { s.noise(o, t, 0.035, { type: 'bandpass', f: 2400 + Math.random() * 800, q: 2, gain: 0.35 }); s.tone(o, t, 0.02, { f: 180, gain: 0.15 }); },
  bell(s, o, t) { s.tone(o, t, 1.6, { f: 880, gain: 0.25 }); s.tone(o, t, 1.2, { f: 1320, gain: 0.08 }); },
  page(s, o, t) { s.noise(o, t, 0.35, { type: 'bandpass', f: 3000, f2: 1200, q: 0.6, gain: 0.25, attack: 0.08, curve: 'lin' }); },
  stamp(s, o, t) { s.noise(o, t, 0.12, { type: 'lowpass', f: 900, gain: 1 }); s.tone(o, t, 0.12, { f: 90, f2: 50, gain: 0.6 }); },
  step(s, o, t) { s.noise(o, t, 0.06, { type: 'lowpass', f: 700, gain: 0.25 }); },
  stepGravel(s, o, t) { s.noise(o, t, 0.08, { type: 'bandpass', f: 2200, q: 1, gain: 0.3 }); },
  stepWater(s, o, t) { s.noise(o, t, 0.18, { type: 'bandpass', f: 900, f2: 400, q: 2, gain: 0.35 }); },
  knife(s, o, t) { s.noise(o, t, 0.12, { type: 'highpass', f: 3000, f2: 6000, gain: 0.25, attack: 0.05 }); s.tone(o, t + 0.08, 0.15, { f: 110, f2: 60, gain: 0.5 }); },
  punch(s, o, t) { s.tone(o, t, 0.14, { f: 140, f2: 55, gain: 0.7 }); s.noise(o, t, 0.06, { f: 1400, gain: 0.4 }); },
  fall(s, o, t) { s.tone(o, t + 0.25, 0.25, { f: 90, f2: 40, gain: 0.6 }); s.noise(o, t + 0.25, 0.2, { f: 500, gain: 0.5 }); },
  rifle(s, o, t) { s.noise(o, t, 0.5, { type: 'lowpass', f: 4000, f2: 300, gain: 1.4, attack: 0.001 }); s.tone(o, t, 0.22, { f: 160, f2: 40, gain: 0.9 }); s.noise(o, t + 0.06, 1.2, { type: 'lowpass', f: 700, gain: 0.25 }); },
  pistol(s, o, t) { s.noise(o, t, 0.28, { type: 'lowpass', f: 5000, f2: 500, gain: 1.1, attack: 0.001 }); s.tone(o, t, 0.12, { f: 220, f2: 70, gain: 0.6 }); },
  mg(s, o, t) { for (let i = 0; i < 3; i++) { s.noise(o, t + i * 0.07, 0.18, { type: 'lowpass', f: 3500, f2: 400, gain: 1.0 }); s.tone(o, t + i * 0.07, 0.09, { f: 150, f2: 50, gain: 0.6 }); } },
  bren(s, o, t) { for (let i = 0; i < 6; i++) { s.noise(o, t + i * 0.085, 0.2, { type: 'lowpass', f: 3200, f2: 380, gain: 1.0 }); s.tone(o, t + i * 0.085, 0.1, { f: 140, f2: 45, gain: 0.6 }); } },
  suppressed(s, o, t) { s.noise(o, t, 0.09, { type: 'bandpass', f: 1100, q: 1.2, gain: 0.5 }); s.tone(o, t, 0.06, { f: 300, f2: 120, gain: 0.25 }); s.noise(o, t + 0.05, 0.05, { type: 'highpass', f: 4000, gain: 0.12 }); },
  ricochet(s, o, t) { s.tone(o, t, 0.35, { f: 3200, f2: 900, type: 'sine', gain: 0.12 }); },
  explosion(s, o, t) {
    s.noise(o, t, 2.8, { type: 'lowpass', f: 2400, f2: 90, gain: 1.6, attack: 0.003 });
    s.tone(o, t, 1.4, { f: 70, f2: 24, gain: 1.4, decay: 1.2 });
    s.noise(o, t + 0.15, 3.5, { type: 'lowpass', f: 400, f2: 80, gain: 0.5, attack: 0.3 });
    for (let i = 0; i < 6; i++) s.noise(o, t + 0.3 + Math.random() * 1.5, 0.08, { type: 'bandpass', f: 2500, q: 2, gain: 0.25 });
  },
  throw(s, o, t) { s.noise(o, t, 0.22, { type: 'bandpass', f: 800, f2: 2400, q: 1.5, gain: 0.25, attack: 0.08 }); },
  stone(s, o, t) { for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.07 * (1 + Math.random()), 0.06, { f: 1800 + Math.random() * 900, type: 'triangle', gain: 0.35 - i * 0.08 }); },
  firecracker(s, o, t) { for (let i = 0; i < 7; i++) { s.noise(o, t + i * 0.11 + Math.random() * 0.04, 0.09, { type: 'highpass', f: 1200, gain: 1 }); } },
  whistle(s, o, t) { s.tone(o, t, 0.25, { f: 1500, f2: 2100, gain: 0.25 }); s.tone(o, t + 0.28, 0.35, { f: 2100, f2: 1400, gain: 0.25 }); },
  alarm(s, o, t) {
    const ctx = s.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const g = ctx.createGain(); g.gain.value = 0;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 1400;
    osc.connect(flt); flt.connect(g); g.connect(o);
    for (let i = 0; i < 4; i++) { osc.frequency.setValueAtTime(380, t + i * 1.4); osc.frequency.linearRampToValueAtTime(760, t + i * 1.4 + 0.7); osc.frequency.linearRampToValueAtTime(380, t + i * 1.4 + 1.4); }
    g.gain.linearRampToValueAtTime(0.22, t + 0.3); g.gain.setValueAtTime(0.22, t + 5.2); g.gain.linearRampToValueAtTime(0, t + 5.6);
    osc.start(t); osc.stop(t + 5.7);
  },
  spotted(s, o, t) { s.tone(o, t, 0.5, { f: 233, type: 'sawtooth', gain: 0.25 }); s.tone(o, t, 0.5, { f: 277, type: 'sawtooth', gain: 0.2 }); s.noise(o, t, 0.25, { type: 'lowpass', f: 600, gain: 0.5 }); },
  notice(s, o, t) { s.tone(o, t, 0.18, { f: 660, type: 'triangle', gain: 0.12 }); s.tone(o, t + 0.12, 0.2, { f: 880, type: 'triangle', gain: 0.1 }); },
  pickup(s, o, t) { [0, 0.08, 0.16].forEach((d, i) => s.tone(o, t + d, 0.35, { f: [784, 988, 1175][i], gain: 0.18 })); },
  objective(s, o, t) { [0, 0.18, 0.36].forEach((d, i) => s.tone(o, t + d, 1.1, { f: [392, 494, 587][i], type: 'triangle', gain: 0.22 })); },
  fail(s, o, t) { [0, 0.3].forEach((d, i) => s.tone(o, t + d, 1.4, { f: [220, 196][i], type: 'sawtooth', gain: 0.12 })); },
  door(s, o, t) { s.noise(o, t, 0.4, { type: 'bandpass', f: 500, f2: 300, q: 4, gain: 0.35, attack: 0.05 }); s.tone(o, t + 0.35, 0.12, { f: 120, f2: 70, gain: 0.35 }); },
  cut(s, o, t) { s.tone(o, t, 0.05, { f: 3200, type: 'square', gain: 0.12 }); s.tone(o, t + 0.25, 0.05, { f: 3400, type: 'square', gain: 0.12 }); s.tone(o, t + 0.5, 0.06, { f: 2900, type: 'square', gain: 0.14 }); },
  charge(s, o, t) { s.tone(o, t, 0.06, { f: 1200, type: 'square', gain: 0.08 }); s.tone(o, t + 0.12, 0.06, { f: 1600, type: 'square', gain: 0.08 }); },
  splash(s, o, t) { s.noise(o, t, 0.6, { type: 'bandpass', f: 1200, f2: 300, q: 1, gain: 0.6 }); },
  hit(s, o, t) { s.tone(o, t, 0.2, { f: 180, f2: 90, type: 'triangle', gain: 0.6 }); s.noise(o, t, 0.1, { f: 900, gain: 0.5 }); },
  dog(s, o, t) { for (let i = 0; i < 2; i++) { s.tone(o, t + i * 0.22, 0.14, { f: 420, f2: 260, type: 'sawtooth', gain: 0.25 }); s.noise(o, t + i * 0.22, 0.12, { type: 'bandpass', f: 900, q: 3, gain: 0.3 }); } },
  radio(s, o, t) { s.noise(o, t, 0.8, { type: 'bandpass', f: 1800, q: 0.8, gain: 0.25, attack: 0.05, curve: 'lin' }); for (let i = 0; i < 5; i++) s.tone(o, t + 0.1 + i * 0.12, 0.06, { f: 800, type: 'square', gain: 0.05 }); },
  victory(s, o, t) { [[392, 0], [523, 0.25], [659, 0.5], [784, 0.75]].forEach(([f, d]) => s.tone(o, t + d, 1.6, { f, type: 'triangle', gain: 0.2 })); },
  projector(s, o, t) { for (let i = 0; i < 24; i++) s.noise(o, t + i * 0.042, 0.02, { type: 'bandpass', f: 1600, q: 3, gain: 0.08 }); },

  // ---------- period sounds for missions (api.sound / api.flyover) ----------
  // A piston-engined aircraft crossing the sky: engine buzz with Doppler, a filter that opens as it
  // passes, a stereo sweep along its track and, for a strafing run, a burst from its guns. With a
  // live api.flyover the timing, side and type come from the plane itself (world.s.planes).
  aircraft(s, o, t, opts) {
    const ctx = s.ctx, P = planeInfo(s, opts);
    const T = P.T, n = 96, bomber = P.kind === 'bomber';
    const w = bomber ? 2.6 : P.strafe ? 0.9 : 1.6;            // how sharp the pass is (low and fast = sharp)
    const u = (i) => ((i / (n - 1)) * T - P.tPass) / w;
    const r = (i) => Math.sqrt(1 + u(i) * u(i) * 4);
    const edge = (i) => Math.min(1, (i / (n - 1)) * T / 1.5, (T - (i / (n - 1)) * T) / 2.5);
    const amp = curve(n, (i) => 0.0001 + Math.max(0, edge(i)) * (1 / Math.pow(r(i), 1.15)) * (u(i) > 0 ? 0.85 : 1));
    const dop = (f) => curve(n, (i) => f * (1 - (bomber ? 0.045 : P.strafe ? 0.11 : 0.08) * Math.tanh(u(i) * 1.4)));
    const cut = curve(n, (i) => 260 + 2600 / Math.pow(r(i), 1.3) * (u(i) > 0 ? 0.7 : 1));
    const pan = curve(n, (i) => P.pan0 + (P.pan1 - P.pan0) * 0.5 * (1 + Math.tanh(u(i) * 1.2)));
    const env = ctx.createGain(); env.gain.value = 0; env.gain.setValueCurveAtTime(amp, t, T);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9; lp.frequency.setValueCurveAtTime(cut, t, T);
    const rough = ctx.createGain(); rough.gain.value = 1;
    const sp = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    lp.connect(rough); rough.connect(env);
    if (sp) { sp.pan.setValueCurveAtTime(pan, t, T); env.connect(sp); sp.connect(o); } else env.connect(o);
    const stop = t + T + 0.1, nodes = [];
    // Engines: sawtooth buzz plus a propeller undertone. Bombers carry several engines out of
    // sync, whose beating gives the familiar throb.
    const f0 = bomber ? 58 : 84;
    const det = bomber ? [1, 1.013, 0.988] : [1];
    for (const d of det) {
      for (const [mult, type, gain] of [[1, 'sawtooth', 0.32], [0.5, 'square', 0.12], [2, 'sawtooth', 0.08]]) {
        const osc = ctx.createOscillator(); osc.type = type;
        osc.frequency.setValueCurveAtTime(dop(f0 * d * mult), t, T);
        const g = ctx.createGain(); g.gain.value = gain / det.length * (bomber ? 1.6 : 1);
        osc.connect(g); g.connect(lp); nodes.push(osc);
      }
    }
    // Rough firing: a slow wobble on the engine level.
    for (const [f, d] of [[7.3, 0.12], [11.1, 0.08]]) { const l = ctx.createOscillator(); l.frequency.value = f; const lg = ctx.createGain(); lg.gain.value = d; l.connect(lg); lg.connect(rough.gain); nodes.push(l); }
    // Air rush, loudest at the pass.
    const ns = ctx.createBufferSource(); ns.buffer = s.a.noiseBuf; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.5; bp.frequency.setValueCurveAtTime(curve(n, (i) => 500 + 1600 / r(i)), t, T);
    const ng = ctx.createGain(); ng.gain.value = 0.22; ns.connect(bp); bp.connect(ng); ng.connect(env); nodes.push(ns);
    for (const x of nodes) { x.start(t); x.stop(stop); }
    // Strafing: the guns open up just before it passes overhead.
    if (P.strafe) {
      const gun = ctx.createGain(); gun.gain.value = 0.9; gun.connect(sp || o);
      const t0 = t + Math.max(0.3, P.tPass - 0.7);
      for (let k = 0; k < 30; k++) {
        const tk = t0 + k * 0.045 + Math.random() * 0.008;
        s.noise(gun, tk, 0.05, { type: 'bandpass', f: 1500 + Math.random() * 900, q: 0.9, gain: 0.55 });
        s.tone(gun, tk, 0.05, { f: 130, f2: 60, gain: 0.35 });
      }
    }
  },
  // An incoming shell: a falling whistle, then the crump.
  shell(s, o, t) {
    const d = 1.4 + Math.random() * 0.5;
    const ctx = s.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(1350, t); osc.frequency.exponentialRampToValueAtTime(430, t + d);
    const vib = ctx.createOscillator(); vib.frequency.value = 9; const vg = ctx.createGain(); vg.gain.value = 14; vib.connect(vg); vg.connect(osc.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + d * 0.9); g.gain.linearRampToValueAtTime(0.0001, t + d);
    osc.connect(g); g.connect(o); osc.start(t); vib.start(t); osc.stop(t + d + 0.05); vib.stop(t + d + 0.05);
    s.noise(o, t + d * 0.3, d * 0.7, { type: 'bandpass', f: 2600, f2: 900, q: 1.5, gain: 0.07, attack: d * 0.6, curve: 'lin' });
    const c = t + d;
    s.noise(o, c, 2.2, { type: 'lowpass', f: 1200, f2: 70, gain: 1.4, attack: 0.004 });
    s.tone(o, c, 1.2, { f: 62, f2: 24, gain: 1.2, decay: 1.0 });
    s.noise(o, c + 0.1, 2.6, { type: 'lowpass', f: 320, f2: 60, gain: 0.45, attack: 0.25 });
    for (let i = 0; i < 5; i++) s.noise(o, c + 0.25 + Math.random() * 1.2, 0.07, { type: 'bandpass', f: 2200, q: 2, gain: 0.18 });
  },
  // A signal flare or star shell: the launch thump, a hiss rising, the pop, then the burning fizz.
  flare(s, o, t) {
    s.tone(o, t, 0.16, { f: 170, f2: 60, gain: 0.5 });
    s.noise(o, t, 0.1, { type: 'lowpass', f: 1200, gain: 0.5 });
    s.noise(o, t + 0.05, 0.95, { type: 'highpass', f: 1800, f2: 5500, gain: 0.22, attack: 0.3, curve: 'lin' });
    s.noise(o, t + 1.0, 0.09, { type: 'lowpass', f: 2600, gain: 0.55 });
    const ctx = s.ctx, f = ctx.createGain(); f.gain.value = 1; f.connect(o);
    const fl = ctx.createOscillator(); fl.frequency.value = 13; const fg = ctx.createGain(); fg.gain.value = 0.35; fl.connect(fg); fg.connect(f.gain); fl.start(t + 1); fl.stop(t + 5.2);
    s.noise(f, t + 1.05, 4, { type: 'bandpass', f: 3400, q: 0.7, gain: 0.12, attack: 0.15, curve: 'lin' });
  },
  // A searchlight switched on: a heavy contactor clunk, the arc striking, its hum.
  searchlight(s, o, t) {
    s.noise(o, t, 0.06, { type: 'lowpass', f: 1600, gain: 0.8 });
    s.tone(o, t, 0.14, { f: 95, f2: 55, gain: 0.55 });
    for (let i = 0; i < 6; i++) s.noise(o, t + 0.08 + Math.random() * 0.35, 0.03, { type: 'bandpass', f: 2800 + Math.random() * 1500, q: 3, gain: 0.18 });
    const ctx = s.ctx, osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 100;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + 0.1); g.gain.linearRampToValueAtTime(0.07, t + 0.5); g.gain.setValueAtTime(0.07, t + 1.4); g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(lp); lp.connect(g); g.connect(o); osc.start(t + 0.1); osc.stop(t + 2.5);
  },
  // A match struck: the scrape, the flare-up, a small fizz.
  match(s, o, t) {
    s.noise(o, t, 0.14, { type: 'bandpass', f: 2600, f2: 4200, q: 1.2, gain: 0.3, attack: 0.02 });
    s.noise(o, t + 0.12, 0.7, { type: 'lowpass', f: 1800, f2: 700, gain: 0.32, attack: 0.04 });
    s.noise(o, t + 0.2, 1.3, { type: 'bandpass', f: 3800, q: 1, gain: 0.05, attack: 0.1, curve: 'lin' });
  },
  // A heavy gate: hinge creak, then the clank of the bar.
  gate(s, o, t) {
    const ctx = s.ctx, osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t); osc.frequency.linearRampToValueAtTime(340, t + 0.35); osc.frequency.linearRampToValueAtTime(230, t + 0.75);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(bp); bp.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.85);
    s.tone(o, t + 0.8, 0.5, { f: 520, type: 'triangle', gain: 0.18 }); s.tone(o, t + 0.8, 0.35, { f: 1190, type: 'triangle', gain: 0.08 });
    s.noise(o, t + 0.8, 0.08, { type: 'lowpass', f: 1500, gain: 0.5 });
  },
  // A steam train going by: whistle, chuffs, wheels on rail joints.
  train(s, o, t) {
    const T = 11, ctx = s.ctx, m = ctx.createGain(); m.connect(o);
    m.gain.setValueAtTime(0.0001, t); m.gain.linearRampToValueAtTime(2.2, t + T * 0.45); m.gain.linearRampToValueAtTime(0.0001, t + T);
    for (const [f, gg] of [[392, 0.07], [494, 0.06], [587, 0.04]]) s.tone(m, t + 0.4, 1.6, { f, type: 'triangle', gain: gg * 6, attack: 0.08 });
    s.noise(m, t + 0.4, 1.6, { type: 'bandpass', f: 1800, q: 2, gain: 0.25, attack: 0.08 });
    for (let k = 0, tk = t; tk < t + T; k++, tk += 0.27) s.noise(m, tk, 0.2, { type: 'lowpass', f: k % 4 === 0 ? 900 : 650, gain: k % 4 === 0 ? 0.6 : 0.4, attack: 0.01 });
    for (let tk = t + 1; tk < t + T; tk += 1.05) { s.tone(m, tk, 0.05, { f: 1300, type: 'square', gain: 0.06 }); s.tone(m, tk + 0.16, 0.05, { f: 1200, type: 'square', gain: 0.06 }); }
    loopFor(s, m, t, T, { type: 'lowpass', f: 180, gain: 0.35 });
  },
  // A motor launch or E-boat passing: low engine putter and the wash.
  boat(s, o, t) {
    const T = 9, ctx = s.ctx, m = ctx.createGain(); m.connect(o);
    m.gain.setValueAtTime(0.0001, t); m.gain.linearRampToValueAtTime(1, t + T * 0.45); m.gain.linearRampToValueAtTime(0.0001, t + T);
    engine(s, m, t, T, 52, 13, 0.4);
    s.noise(m, t, T, { type: 'bandpass', f: 900, q: 0.5, gain: 0.25, attack: T * 0.5, curve: 'lin' });
  },
  // Thunder: a crack and a long roll.
  thunder(s, o, t) {
    s.noise(o, t, 0.25, { type: 'highpass', f: 900, gain: 0.35 });
    s.noise(o, t + 0.05, 5, { type: 'lowpass', f: 380, f2: 60, gain: 1.0, attack: 0.4 });
    for (let i = 0; i < 4; i++) s.noise(o, t + 0.6 + Math.random() * 2.5, 1.5, { type: 'lowpass', f: 260, f2: 70, gain: 0.5, attack: 0.3 });
  },
};

// Sounds heard across the whole map (volume, no distance falloff).
const GLOBAL = { aircraft: 0.9, thunder: 0.8 };

// What to make of a flyover: from the newest live plane if there is one, else a generic pass
// (api.sound('aircraft', x, y) from a script).
function planeInfo(s, opts = {}) {
  const L = s.a.listener || { x: 0, y: 0 };
  const w = globalThis.__nj && globalThis.__nj.screen && globalThis.__nj.screen.world;
  const ps = w && w.s && w.s.planes;
  const p = ps && ps.length ? ps[ps.length - 1] : null;
  const pan = (x, y) => Math.max(-0.8, Math.min(0.8, s.a.spatial(x, y).pan * 1.3));
  if (p && w.s.t - p.t0 < 1) {
    // Closest approach to the camera along the track; the sound starts 3 s before the plane enters.
    const dx = p.x1 - p.x0, dy = p.y1 - p.y0, len2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((L.x - p.x0) * dx + (L.y - p.y0) * dy) / len2));
    const lead = 3;
    return { kind: p.kind, strafe: p.strafe, tPass: lead + k * p.dur, T: Math.min(18, Math.max(8, p.dur + lead + 4)), pan0: pan(p.x0, p.y0), pan1: pan(p.x1, p.y1) };
  }
  const side = opts.x !== undefined ? pan(opts.x, opts.y) : 0;
  const dir = side >= 0 ? 1 : -1;
  return { kind: opts.kind || 'plane', strafe: !!opts.strafe, tPass: 4.5, T: 10, pan0: -0.7 * dir, pan1: 0.7 * dir };
}
function curve(n, fn) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = fn(i); return a; }
// Low noise bed under a one-shot, for its length.
function loopFor(s, dest, t, T, { type, f, gain }) { s.noise(dest, t, T, { type, f, gain, attack: T * 0.4, curve: 'lin' }); }
// A slow piston engine: thumps at `rate` per second on a low tone.
function engine(s, dest, t, T, f, rate, gain) {
  const ctx = s.ctx;
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
  const g = ctx.createGain(); g.gain.value = gain * 0.5;
  const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = rate;
  const ag = ctx.createGain(); ag.gain.value = gain * 0.45; am.connect(ag); ag.connect(g.gain);
  osc.connect(lp); lp.connect(g); g.connect(dest);
  osc.start(t); am.start(t); osc.stop(t + T); am.stop(t + T);
}

// Looping ambiences built from scheduled noise and tones.
const AMBIENCE = {
  wind(s) { return loopNoise(s, { type: 'lowpass', f: 380, gain: 0.25, lfo: 0.07, lfoDepth: 220 }); },
  breeze(s) { return loopNoise(s, { type: 'bandpass', f: 900, q: 0.5, gain: 0.08, lfo: 0.11, lfoDepth: 400 }); },
  rain(s) { const a = loopNoise(s, { type: 'highpass', f: 1200, gain: 0.22, lfo: 0.2, lfoDepth: 200 }); const b = loopNoise(s, { type: 'lowpass', f: 500, gain: 0.12 }); return { stop() { a.stop(); b.stop(); } }; },
  sea(s) { return loopNoise(s, { type: 'lowpass', f: 600, gain: 0.3, lfo: 0.09, lfoDepth: 450, ampLfo: 0.1 }); },
  river(s) { return loopNoise(s, { type: 'bandpass', f: 1500, q: 0.6, gain: 0.12, lfo: 0.3, lfoDepth: 300 }); },
  fire(s) { return scheduler(s, 0.05, (o, t) => { if (Math.random() < 0.3) s.noise(o, t, 0.03 + Math.random() * 0.05, { type: 'bandpass', f: 1500 + Math.random() * 2500, q: 2, gain: 0.15 * Math.random() }); }, 0.6); },
  crickets(s) { return scheduler(s, 0.35, (o, t) => { if (Math.random() < 0.6) for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.045, 0.03, { f: 4200 + Math.random() * 300, gain: 0.025 }); }, 0.5); },
  birds(s) { return scheduler(s, 0.9, (o, t) => { if (Math.random() < 0.35) { const f = 2400 + Math.random() * 1800; const n = 2 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) s.tone(o, t + i * 0.1, 0.08, { f: f * (1 + (Math.random() - 0.5) * 0.2), f2: f * 1.25, gain: 0.04 }); } }, 0.6); },
  gulls(s) { return scheduler(s, 2.2, (o, t) => { if (Math.random() < 0.4) for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.28, 0.25, { f: 1700, f2: 1100, type: 'triangle', gain: 0.04 }); }, 0.6); },
  artillery(s) { return scheduler(s, 3.5, (o, t) => { if (Math.random() < 0.45) { s.tone(o, t, 2.4, { f: 48 + Math.random() * 20, f2: 22, gain: 0.35 }); s.noise(o, t, 2.4, { type: 'lowpass', f: 220, f2: 60, gain: 0.35 }); } }, 0.9); },
  jungle(s) { const a = AMBIENCE.crickets(s); const b = scheduler(s, 1.3, (o, t) => { if (Math.random() < 0.3) { const f = 900 + Math.random() * 1400; s.tone(o, t, 0.3, { f, f2: f * 0.7, type: 'triangle', gain: 0.05 }); s.tone(o, t + 0.35, 0.25, { f: f * 1.1, f2: f * 0.8, type: 'triangle', gain: 0.04 }); } }, 0.7); return { stop() { a.stop(); b.stop(); } }; },
  city(s) { const a = loopNoise(s, { type: 'lowpass', f: 250, gain: 0.12 }); const b = scheduler(s, 4, (o, t) => { if (Math.random() < 0.3) s.tone(o, t, 1.2, { f: 330, type: 'triangle', gain: 0.02 }); }, 0.8); return { stop() { a.stop(); b.stop(); } }; },
  // A boat's engine under way (MTB, launch, fishing boat): steady putter.
  boat(s) { return loopEngine(s, 48, 11, 0.12); },
  // A train somewhere in the valley: chuffs and, now and then, its whistle.
  train(s) {
    let k = 0;
    return scheduler(s, 0.28, (o, t) => {
      k++;
      s.noise(o, t, 0.16, { type: 'lowpass', f: k % 4 === 0 ? 520 : 400, gain: 0.07 });
      if (Math.random() < 0.006) for (const f of [392, 494]) s.tone(o, t, 1.4, { f, type: 'triangle', gain: 0.025, attack: 0.1 });
    }, 0.8);
  },
  // A bomber stream far overhead: unsynchronised engines throbbing, swelling and fading.
  bombers(s) {
    const ctx = s.ctx, out = ctx.createGain(); out.gain.value = 0; out.connect(s.a.bus.amb);
    out.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 230; lp.connect(out);
    const swell = ctx.createOscillator(); swell.frequency.value = 0.05; const sg = ctx.createGain(); sg.gain.value = 0.025; swell.connect(sg); sg.connect(out.gain);
    const nodes = [swell];
    for (const f of [55, 55.7, 54.4, 56.3]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); nodes.push(o); }
    nodes.forEach((n) => n.start());
    return { stop() { out.gain.setTargetAtTime(0, ctx.currentTime, 0.6); setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch (e) { /* stopped */ } }), 3000); } };
  },
  // Rain, wind and thunder rolling in from time to time.
  storm(s) {
    const a = AMBIENCE.rain(s), b = AMBIENCE.wind(s);
    const c = scheduler(s, 14, (o, t) => { if (Math.random() < 0.5) SOUNDS.thunder(s, o, t); }, 0.45);
    return { stop() { a.stop(); b.stop(); c.stop(); } };
  },
  // The nightjar's churr: a long mechanical trill, the game's signature sound.
  nightjar(s) { return scheduler(s, 6, (o, t) => { if (Math.random() < 0.55) churr(s, o, t, 2.5 + Math.random() * 3); }, 0.7); },
};

export function churr(s, o, t, dur = 3, gain = 0.06) {
  const ctx = s.ctx;
  const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = 640;
  const mod = ctx.createOscillator(); mod.type = 'square'; mod.frequency.value = 27;
  // Square-wave amplitude modulation (0..1) gives the rapid, purring pulse.
  const am = ctx.createGain(); am.gain.value = 0.5;
  const g = ctx.createGain(); g.gain.value = 0.5;
  mod.connect(am); am.connect(g.gain);
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + 0.3); env.gain.setValueAtTime(gain, t + dur - 0.4); env.gain.linearRampToValueAtTime(0, t + dur);
  car.connect(g); g.connect(env); env.connect(o);
  // The pitch wavers as the bird turns its head.
  car.frequency.setValueAtTime(640, t); car.frequency.linearRampToValueAtTime(700, t + dur * 0.5); car.frequency.linearRampToValueAtTime(600, t + dur);
  car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
}

// A continuous piston engine for ambience (thumps at `rate` per second on a low tone).
function loopEngine(s, f, rate, gain) {
  const ctx = s.ctx, out = ctx.createGain(); out.gain.value = 0; out.connect(s.a.bus.amb);
  out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  const t = ctx.currentTime, osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const g = ctx.createGain(); g.gain.value = gain * 0.5;
  const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = rate;
  const ag = ctx.createGain(); ag.gain.value = gain * 0.45; am.connect(ag); ag.connect(g.gain);
  osc.connect(lp); lp.connect(g); g.connect(out); osc.start(t); am.start(t);
  return { stop() { out.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(() => { try { osc.stop(); am.stop(); } catch (e) { /* stopped */ } }, 2000); } };
}

function loopNoise(s, { type, f, q = 0.7, gain, lfo, lfoDepth, ampLfo }) {
  const ctx = s.ctx;
  const src = ctx.createBufferSource(); src.buffer = s.a.noiseBuf; src.loop = true;
  const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 2);
  src.connect(flt); flt.connect(g); g.connect(s.a.bus.amb);
  const nodes = [src];
  if (lfo) { const o = ctx.createOscillator(); o.frequency.value = lfo; const d = ctx.createGain(); d.gain.value = lfoDepth; o.connect(d); d.connect(flt.frequency); o.start(); nodes.push(o); }
  if (ampLfo) { const o = ctx.createOscillator(); o.frequency.value = ampLfo; const d = ctx.createGain(); d.gain.value = gain * 0.6; o.connect(d); d.connect(g.gain); o.start(); nodes.push(o); }
  src.start();
  return { stop() { const t = ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.4); setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } }), 2000); } };
}

function scheduler(s, every, fn, vol = 1) {
  const out = s.ctx.createGain(); out.gain.value = vol; out.connect(s.a.bus.amb);
  const rev = s.ctx.createGain(); rev.gain.value = 0.3; out.connect(rev); rev.connect(s.a.reverb);
  let alive = true;
  const tick = () => { if (!alive) return; fn(out, s.ctx.currentTime + 0.05); setTimeout(tick, every * 1000 * (0.6 + Math.random() * 0.8)); };
  tick();
  return { stop() { alive = false; out.gain.setTargetAtTime(0, s.ctx.currentTime, 0.3); } };
}
