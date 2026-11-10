// The synthesized score: an original main theme plus an adaptive sequencer (explore, tension,
// alarm, title, documentary, letter, victory, defeat) whose colour and key follow the theatre.
// Since the recorded score arrived (music.js), this only provides short stingers and a fallback
// for any mood whose recordings cannot be played.

// Main theme in scale steps from the key root (semitones), [offset, beats]. 8 bars of 4/4.
const THEME = [[0, 2], [3, 1], [7, 1], [5, 3], [3, 1], [2, 2], [-2, 1], [2, 1], [0, 4],
  [7, 2], [10, 1], [12, 1], [8, 3], [7, 1], [5, 1], [7, 1], [3, 1], [2, 1], [0, 4]];
// Chords under the theme, one per bar (semitones from root).
const THEME_CHORDS = [[0, 3, 7], [-4, 0, 5], [-2, 2, 5], [0, 3, 7], [3, 7, 10], [-4, 0, 3], [-5, -1, 2], [0, 3, 7]];
// Bars of the theme as separate phrases for motif development.
const PHRASES = (() => { const out = []; let bar = [], beats = 0; for (const n of THEME) { bar.push(n); beats += n[1]; if (beats >= 4) { out.push(bar); bar = []; beats = 0; } } return out; })();

const PROGRESSIONS = {
  explore: [[[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]], [[0, 3, 7], [5, 8, 12], [-5, 0, 3], [0, 3, 7]], [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [-4, 0, 5]], [[0, 3, 7], [-2, 3, 7], [-4, 0, 3], [-5, -1, 2]]],
  tension: [[[0, 3, 7], [1, 5, 8], [0, 3, 7], [-1, 3, 6]], [[0, 3, 6], [0, 3, 7], [1, 4, 8], [0, 3, 7]]],
  alarm: [[[0, 3, 7], [1, 5, 8], [-2, 2, 5], [-5, -1, 2]], [[0, 3, 7], [-4, 0, 3], [1, 5, 8], [-5, -1, 2]]],
};

const THEATRES = {
  'Western Europe': { root: 50, lead: 'horn', pad: 'strings', color: 'bell' },
  'Central Europe': { root: 50, lead: 'horn', pad: 'strings', color: 'bell' },
  'Eastern Europe': { root: 50, lead: 'piano', pad: 'strings', color: 'bell' },
  'Northern Europe': { root: 45, lead: 'horn', pad: 'strings', color: 'bell' },
  'Eastern Front': { root: 52, lead: 'horn', pad: 'choir', color: 'bell' },
  'North Africa': { root: 50, lead: 'flute', pad: 'strings', color: 'pluck' },
  'Middle East': { root: 50, lead: 'flute', pad: 'strings', color: 'pluck' },
  'Mediterranean': { root: 48, lead: 'flute', pad: 'strings', color: 'pluck' },
  'Atlantic': { root: 50, lead: 'horn', pad: 'strings', color: 'bell' },
  'South Atlantic': { root: 50, lead: 'piano', pad: 'strings', color: 'pluck' },
  'Pacific': { root: 51, lead: 'flute', pad: 'strings', color: 'pluck', penta: true },
  'Asia': { root: 51, lead: 'flute', pad: 'strings', color: 'pluck', penta: true },
  'China': { root: 51, lead: 'flute', pad: 'strings', color: 'pluck', penta: true },
  'Burma': { root: 51, lead: 'flute', pad: 'strings', color: 'pluck', penta: true },
  'Indian Ocean': { root: 51, lead: 'flute', pad: 'strings', color: 'pluck', penta: true },
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// Pentatonic colouring for Asian and Pacific chapters: nudge 2nd and 6th degrees.
const penta = (o) => { const pc = ((o % 12) + 12) % 12; return pc === 2 ? o + 1 : pc === 8 ? o - 1 : o; };

export class SynthScore {
  constructor(engine) {
    this.a = engine;
    this.mood = 'silence';
    this.th = THEATRES['Western Europe'];
    this.night = false;
    this.layer = null;
    this.timer = null;
  }
  get ctx() { return this.a.ctx; }

  setTheatre(name, night = false) { this.th = THEATRES[name] || THEATRES['Western Europe']; this.night = night; }

  setMood(mood, force = false) {
    if (!this.a.ready) { this.mood = mood; return; }
    if (mood === this.mood && !force) return;
    this.mood = mood;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.layer) { const old = this.layer; old.gain.gain.cancelScheduledValues(now); old.gain.gain.setTargetAtTime(0, now, mood === 'alarm' ? 0.15 : 0.8); setTimeout(() => old.gain.disconnect(), 6000); }
    if (mood === 'silence') { this.layer = null; return; }
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.a.bus.music);
    g.gain.setTargetAtTime(1, now, mood === 'alarm' ? 0.05 : 0.6);
    const wet = ctx.createGain(); wet.gain.value = this.night ? 0.6 : 0.45; g.connect(wet); wet.connect(this.a.reverb);
    this.layer = { gain: g, mood, start: now + 0.1, step: 0, next: now + 0.1, bar: 0, prog: null, phraseLoop: 0 };
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
  }

  stop() { this.setMood('silence'); if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tempo(mood) { return { title: 70, explore: 64, tension: 92, alarm: 132, documentary: 58, letter: 54, victory: 76, defeat: 56 }[mood] || 64; }

  tick() {
    const L = this.layer;
    if (!L || !this.a.ready) return;
    const ctx = this.ctx;
    const spb = 60 / this.tempo(L.mood);    // seconds per beat
    const sixteenth = spb / 4;
    while (L.next < ctx.currentTime + 0.15) {
      this.sequence(L, L.step, L.next, spb);
      L.step++;
      L.next += sixteenth;
    }
  }

  note(o) { const r = this.th.root; return this.th.penta ? r + penta(o) : r + o; }

  // One sixteenth-note step of the current mood.
  sequence(L, step, t, spb) {
    const bar = Math.floor(step / 16), s16 = step % 16;
    const o = L.gain;
    const m = L.mood;
    if (m === 'title' || m === 'victory' || m === 'documentary' || m === 'letter') return this.themeCue(L, step, t, spb);
    if (m === 'defeat') {
      if (step === 0) { this.pad(o, [0, 3, 7].map((x) => this.note(x - 12)), t, spb * 12, 0.5); this.timp(o, this.note(-12), t, 0.6); }
      if (step === 32) this.pad(o, [-4, 0, 3].map((x) => this.note(x - 12)), t, spb * 12, 0.35);
      return;
    }
    const progs = PROGRESSIONS[m] || PROGRESSIONS.explore;
    if (s16 === 0 && bar % 4 === 0) L.prog = progs[Math.floor(Math.random() * progs.length)];
    const chord = (L.prog || progs[0])[bar % 4];
    if (m === 'explore') {
      if (s16 === 0) {
        this.pad(o, chord.map((x) => this.note(x)), t, spb * 4.2, this.night ? 0.22 : 0.28);
        if (bar % 2 === 0) this.cello(o, this.note(chord[0] - 12), t, spb * 3.5, 0.18, true);
      }
      // Every other phrase, the lead remembers a fragment of the theme.
      if (bar % 8 === 4 && s16 === 0 && Math.random() < 0.7) {
        const ph = PHRASES[Math.floor(Math.random() * PHRASES.length)];
        let tt = t;
        for (const [n, b] of ph) { this.lead(o, this.note(n + 12), tt, spb * b * 0.95, 0.16); tt += spb * b; }
      }
      if (s16 === 8 && Math.random() < 0.18) this.color(o, this.note(chord[Math.floor(Math.random() * 3)] + 24), t, 0.07);
      return;
    }
    if (m === 'tension') {
      if (s16 === 0) this.pad(o, chord.map((x) => this.note(x)), t, spb * 4, 0.24);
      if (s16 % 2 === 0) { const pat = [0, 0, 7, 0, 12, 0, 7, 0]; this.cello(o, this.note(chord[0] - 12 + pat[(s16 / 2) % 8]), t, spb * 0.4, 0.2); }
      if (s16 === 0 && bar % 2 === 0) this.timp(o, this.note(-12), t, 0.35);
      if (s16 === 12 && bar % 4 === 3) this.color(o, this.note(chord[2] + 12), t, 0.06);
      return;
    }
    if (m === 'alarm') {
      if (s16 === 0) { this.pad(o, chord.map((x) => this.note(x)), t, spb * 4, 0.28); this.timp(o, this.note(-12), t, 0.6); }
      this.cello(o, this.note(chord[0] - 12 + (s16 % 4 === 2 ? 7 : 0)), t, spb * 0.22, 0.22);
      if (s16 === 4 || s16 === 12) this.snare(o, t, 0.5);
      if (s16 === 0 || s16 === 10) this.kick(o, t, 0.7);
      if (s16 % 2 === 1) this.snare(o, t, 0.08);
      if (s16 === 0 && bar % 2 === 1) { this.brass(o, chord.map((x) => this.note(x + 12)), t, spb * 0.8, 0.22); }
      if (bar % 4 === 2 && s16 === 0) { const ph = PHRASES[[0, 4][Math.floor(Math.random() * 2)]]; let tt = t; for (const [n, b] of ph) { this.lead(o, this.note(n + 12), tt, spb * b * 0.5, 0.2, 'horn'); tt += spb * b * 0.5; } }
    }
  }

  // Through-composed cues built on the theme.
  themeCue(L, step, t, spb) {
    const m = L.mood;
    const o = L.gain;
    const total = THEME.reduce((s, n) => s + n[1], 0) * 4; // in sixteenths
    const loopLen = total + 32;
    const pos = step % loopLen;
    const loop = Math.floor(step / loopLen);
    if (m === 'victory' && loop > 0) return;
    // Schedule theme notes at their sixteenth positions.
    let acc = 0;
    for (const [n, b] of THEME) {
      if (acc === pos) {
        const major = m === 'victory';
        let off = n;
        if (major && (off % 12 === 3 || off % 12 === -9)) off += 1;
        const dur = spb * b * 0.96;
        if (m === 'letter') this.piano(o, this.note(off + 12), t, dur * 1.6, 0.32);
        else if (m === 'documentary') { this.piano(o, this.note(off + 12), t, dur * 1.4, 0.26); if (loop % 2 === 1) this.lead(o, this.note(off), t, dur, 0.1, 'strings'); }
        else this.lead(o, this.note(off + 12), t, dur, m === 'victory' ? 0.3 : 0.26, this.th.lead);
      }
      acc += b * 4;
    }
    if (pos % 16 === 0 && pos < total) {
      const bar = pos / 16;
      let ch = THEME_CHORDS[bar % 8];
      if (m === 'victory' && bar === 7) ch = [0, 4, 7];
      const vol = m === 'letter' ? 0.12 : m === 'documentary' ? 0.2 : 0.26;
      this.pad(o, ch.map((x) => this.note(x)), t, spb * 4.3, vol);
      if (m !== 'letter') this.cello(o, this.note(ch[0] - 12), t, spb * 3.6, 0.16, true);
      if (m === 'letter') this.piano(o, this.note(ch[0] - 12), t, spb * 3.8, 0.16);
      if (m === 'title' && bar % 4 === 0) this.timp(o, this.note(-12), t, 0.35);
      if ((m === 'title' || m === 'documentary') && this.th.color === 'pluck') for (let i = 0; i < 4; i++) this.pluck(o, this.note(ch[i % 3] + 12 + (i === 3 ? 12 : 0)), t + i * spb, 0.08);
      if (m === 'victory' && bar === 7) { this.timp(o, this.note(-12), t, 0.6); this.brass(o, [0, 4, 7].map((x) => this.note(x + 12)), t, spb * 4, 0.25); }
    }
  }

  // ---------- instruments ----------
  env(g, t, a, d, peak, sustain = null) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (sustain !== null) { g.gain.setValueAtTime(peak, t + Math.max(a, d - 0.6)); g.gain.linearRampToValueAtTime(0.0001, t + d + sustain); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  }
  pad(o, notes, t, dur, vol) {
    if (this.th.pad === 'choir') return this.choir(o, notes, t, dur, vol);
    const ctx = this.ctx;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = this.night ? 1300 : 1900; flt.Q.value = 0.4;
    const g = ctx.createGain(); this.env(g, t, Math.min(1.2, dur * 0.3), dur, vol / notes.length, 1.4);
    flt.connect(g); g.connect(o);
    for (const n of notes) for (const det of [-8, 0, 7]) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = mtof(n); osc.detune.value = det + (Math.random() - 0.5) * 4;
      osc.connect(flt); osc.start(t); osc.stop(t + dur + 1.6);
    }
  }
  choir(o, notes, t, dur, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain(); this.env(g, t, Math.min(1.5, dur * 0.35), dur, vol / notes.length * 1.4, 1.6);
    g.connect(o);
    for (const n of notes) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = mtof(n);
      const vib = ctx.createOscillator(); vib.frequency.value = 4.6; const vd = ctx.createGain(); vd.gain.value = 6; vib.connect(vd); vd.connect(osc.detune);
      for (const [f, q, gg] of [[700, 6, 1], [1150, 8, 0.6], [2600, 10, 0.2]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const fg = ctx.createGain(); fg.gain.value = gg * 2.2;
        osc.connect(bp); bp.connect(fg); fg.connect(g);
      }
      osc.start(t); vib.start(t); osc.stop(t + dur + 1.8); vib.stop(t + dur + 1.8);
    }
  }
  cello(o, n, t, dur, vol, legato = false) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = mtof(n);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = legato ? 700 : 1100; flt.Q.value = 0.8;
    const g = ctx.createGain();
    if (legato) this.env(g, t, 0.25, dur, vol, 0.8); else this.env(g, t, 0.008, Math.max(0.12, dur), vol);
    osc.connect(flt); flt.connect(g); g.connect(o);
    osc.start(t); osc.stop(t + dur + 1);
  }
  lead(o, n, t, dur, vol, kind = this.th.lead) {
    if (kind === 'piano') return this.piano(o, n, t, dur * 1.3, vol * 1.2);
    if (kind === 'flute') return this.flute(o, n, t, dur, vol);
    if (kind === 'strings') return this.pad(o, [n], t, dur, vol * 2);
    const ctx = this.ctx;
    // French horn: two oscillators through an opening filter, with delayed vibrato.
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 1;
    flt.frequency.setValueAtTime(380, t); flt.frequency.linearRampToValueAtTime(1900, t + 0.12); flt.frequency.linearRampToValueAtTime(1200, t + Math.min(dur, 0.6));
    const g = ctx.createGain(); this.env(g, t, 0.07, dur, vol, 0.35);
    flt.connect(g); g.connect(o);
    const vib = ctx.createOscillator(); vib.frequency.value = 5; const vd = ctx.createGain(); vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(9, t + 0.5); vib.connect(vd);
    for (const [type, det, gg] of [['sawtooth', 0, 0.6], ['triangle', 4, 0.8]]) {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = mtof(n); osc.detune.value = det;
      vd.connect(osc.detune);
      const og = ctx.createGain(); og.gain.value = gg; osc.connect(og); og.connect(flt);
      osc.start(t); osc.stop(t + dur + 0.5);
    }
    vib.start(t); vib.stop(t + dur + 0.5);
  }
  brass(o, notes, t, dur, vol) { for (const n of notes) this.lead(o, n, t, dur, vol / notes.length * 1.6, 'horn'); }
  piano(o, n, t, dur, vol) {
    const ctx = this.ctx;
    const f = mtof(n);
    const decay = Math.min(4, Math.max(1.2, 3.5 - (n - 48) * 0.05));
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(o);
    for (const [mult, gg] of [[1, 1], [2, 0.42], [3, 0.18], [4.02, 0.08], [5.03, 0.04]]) {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f * mult; osc.detune.value = (Math.random() - 0.5) * 3;
      const og = ctx.createGain(); og.gain.value = gg; osc.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + decay + 0.1);
    }
  }
  flute(o, n, t, dur, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = mtof(n);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vd = ctx.createGain(); vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(12, t + 0.4); vib.connect(vd); vd.connect(osc.detune);
    const g = ctx.createGain(); this.env(g, t, 0.12, dur, vol, 0.3);
    osc.connect(g); g.connect(o);
    const nz = ctx.createBufferSource(); nz.buffer = this.a.noiseBuf; nz.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = mtof(n) * 2; bp.Q.value = 3;
    const ng = ctx.createGain(); this.env(ng, t, 0.05, dur, vol * 0.25, 0.2);
    nz.connect(bp); bp.connect(ng); ng.connect(o);
    osc.start(t); vib.start(t); nz.start(t, Math.random());
    osc.stop(t + dur + 0.4); vib.stop(t + dur + 0.4); nz.stop(t + dur + 0.4);
  }
  pluck(o, n, t, vol) {
    const ctx = this.ctx;
    const f = mtof(n);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(f * 8, t); flt.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.4);
    flt.connect(g); g.connect(o);
    for (const [type, mult, gg] of [['triangle', 1, 1], ['sawtooth', 1, 0.3], ['sine', 2, 0.3]]) {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f * mult;
      const og = ctx.createGain(); og.gain.value = gg; osc.connect(og); og.connect(flt);
      osc.start(t); osc.stop(t + 1.7);
    }
  }
  color(o, n, t, vol) { if (this.th.color === 'pluck') return this.pluck(o, n, t, vol * 1.6); this.bell(o, n, t, vol); }
  bell(o, n, t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    g.connect(o);
    for (const [mult, gg] of [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.93, 0.08]]) {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = mtof(n) * mult;
      const og = ctx.createGain(); og.gain.value = gg; osc.connect(og); og.connect(g); osc.start(t); osc.stop(t + 3);
    }
  }
  timp(o, n, t, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(mtof(n) * 1.06, t); osc.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 1.9);
    const nz = ctx.createBufferSource(); nz.buffer = this.a.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    nz.connect(lp); lp.connect(ng); ng.connect(o); nz.start(t, Math.random()); nz.stop(t + 0.3);
  }
  snare(o, t, vol) {
    const ctx = this.ctx;
    const nz = ctx.createBufferSource(); nz.buffer = this.a.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    nz.connect(bp); bp.connect(g); g.connect(o); nz.start(t, Math.random()); nz.stop(t + 0.2);
    const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(140, t + 0.05);
    const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(og); og.connect(o); osc.start(t); osc.stop(t + 0.1);
  }
  kick(o, t, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(110, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.4);
  }

  // ---------- stingers ----------
  // A short orchestral hit, independent of the sequencer: covers the moment an alarm track
  // needs to start streaming, and marks the alarm the instant it sounds.
  stinger(kind = 'alarm', vol = 1) {
    if (!this.a.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(this.a.bus.music);
    const wet = ctx.createGain(); wet.gain.value = 0.5; g.connect(wet); wet.connect(this.a.reverb);
    if (kind === 'alarm') {
      this.timp(g, this.note(-12), t, 0.7); this.timp(g, this.note(-12), t + 0.16, 0.45);
      this.brass(g, [0, 3, 7].map((x) => this.note(x)), t, 0.9, 0.42);
      this.snare(g, t, 0.25);
    } else if (kind === 'spotted') {
      this.cello(g, this.note(-11), t, 0.5, 0.18); this.color(g, this.note(13), t, 0.05);
    }
    setTimeout(() => { g.disconnect(); wet.disconnect(); }, 4500);
  }
}
