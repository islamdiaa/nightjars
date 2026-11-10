// The score. Recorded music (content/music.json, entries with "kind": "score") streamed through a
// small pool of HTMLAudioElements, each routed into the music bus by a MediaElementAudioSourceNode
// so that fades are sample-accurate and follow the volume settings (iOS ignores element.volume).
// Streaming keeps memory flat on the iPad: nothing is decoded up front.
//
// Moods and what they play:
//   title        main theme (the epilogue cue on the epilogue screen)
//   documentary  war room, and documentaries without their own recording: documentary set
//   tension      outside a mission (the briefing): briefing set
//   explore / tension / alarm inside a mission: three layers of the mission score
//     explore  a bed from the mission's palette (west, snow, desert, med, sea, pacific, china:
//              theatre + biome + MISSION_PALETTE), rotating with crossfades,
//              never opening with the bed heard at the start of the previous mission
//     tension  layered over explore (explore ducks under it). It also swells softly while guards
//              are suspicious and fades back once the area is calm; a mission script's tension
//              holds until the script says otherwise
//     alarm    cuts in fast (a short synth stinger covers the moment the file starts), then on
//              "explore" fades slowly back to the bed, leaving a residue of tension
//   letter, victory, defeat: their cues (victory and defeat play once)
//   silence      everything fades out (documentary recordings use playTrack/stopTrack)
// The old synthesizer (synth.js) still provides the alarm stinger and plays any mood whose
// recordings are missing or fail to load.

import { SynthScore } from './synth.js';

const DIR = 'assets/music/';
const POOL = 10;                      // audio elements, unlocked together on the first gesture
const RECENT_KEY = 'nj.music.recent'; // opening beds of recent missions

// Theatre -> palette. Snow (biome or weather) overrides the theatre: see paletteFor().
const THEATRE_PALETTE = {
  'Western Europe': 'west', 'Central Europe': 'west', 'Northern Europe': 'west', 'Atlantic': 'west', 'South Atlantic': 'west',
  'Eastern Front': 'snow', 'Eastern Europe': 'snow',
  'North Africa': 'desert', 'Middle East': 'desert', 'Mediterranean': 'med',
  'Pacific': 'pacific', 'Asia': 'pacific', 'China': 'china', 'Burma': 'pacific', 'Indian Ocean': 'pacific',
};
// Per-mission palette overrides where theatre and biome would choose wrongly. A single bed can
// also be pinned to missions with "missions": ["mNN", ...] on its music.json entry.
const MISSION_PALETTE = {
  m13: 'sea', m17: 'sea', m30: 'sea', m37: 'sea', m56: 'sea', // U-boat, Pearl Harbor, the canoe raids, USS Missouri
  m33: 'med', m34: 'med', m36: 'med', m41: 'med',             // Huelva, Sicily, the Po valley, Crete
  m19: 'china',                                              // Sham Shui Po, Kowloon
};

// Trims per mood on top of the files' own normalisation (beds -22 LUFS, tension -20, alarm -16,
// cues -18 to -20). The documentary (like its -18 LUFS recordings played at 0.55) and the
// letter sit lower, under the narration.
const MIX = { explore: 1, tension: 0.95, alarm: 1, title: 0.95, documentary: 0.6, briefing: 0.8, letter: 0.7, victory: 0.95, defeat: 0.95, epilogue: 0.95 };
const CUE_LOOP = { victory: false, defeat: false };
const SYNTH_FOR = { epilogue: 'title', briefing: 'tension' };
const XFADE = { explore: 7, tension: 5, alarm: 3, cue: 6 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const app = () => globalThis.__nj || null;

// Silent WAV for unlocking audio elements inside a user gesture (iOS wants one play() per element).
function silentUrl() {
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// One audio element and its gain in the graph.
class Deck {
  constructor(music) {
    this.m = music;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', '');
    this.g = null; this.node = null; this.layer = null;
    this.track = null; this.state = 'idle'; this.live = false; this.target = -1; this.tau = 0;
    this.onPlaying = null; this.timer = 0; this.unlocked = false;
    this.el.addEventListener('playing', () => { this.live = true; const f = this.onPlaying; this.onPlaying = null; if (f) f(); });
    this.el.addEventListener('error', () => { if (this.track && this.state !== 'idle' && this.el.error) this.m.deckError(this); });
  }
  wire() {
    if (this.g) return true;
    const ctx = this.m.ctx;
    if (!ctx) return false;
    try { this.node = ctx.createMediaElementSource(this.el); } catch (e) { return false; }
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.node.connect(this.g); this.g.connect(this.m.out);
    return true;
  }
  load(track, at = 0, loop = false) {
    this.wire();
    clearTimeout(this.timer);
    this.track = track; this.state = 'loaded'; this.live = false; this.handing = false; this.failed = false; this.onPlaying = null; this.target = 0;
    if (this.g) { const p = this.g.gain, t = this.m.ctx.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(0, t); }
    this.el.loop = loop;
    this.el.src = (track.url || DIR + track.file) + (at > 1 ? `#t=${at.toFixed(1)}` : '');
  }
  play() {
    this.state = 'playing';
    const p = this.el.play();
    if (p && p.then) p.then(() => { this.unlocked = true; }, (err) => this.m.playFailed(this, err));
  }
  fade(v, tau) {
    if (!this.g) return;
    if (Math.abs(v - this.target) < 0.004 && Math.abs(tau - this.tau) < 0.01) return;
    this.target = v; this.tau = tau;
    const p = this.g.gain, t = this.m.ctx.currentTime;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
    p.setTargetAtTime(v, t, Math.max(0.01, tau));
  }
  get level() { return this.g ? this.g.gain.value : 0; }
  get remaining() { const d = this.el.duration; return isFinite(d) && d > 0 ? d - this.el.currentTime : Infinity; }
  // Fade out, then free the element for reuse.
  release(tau = 1) {
    if (this.state === 'idle') return;
    this.fade(0, tau);
    this.state = 'releasing'; this.onPlaying = null;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.free(), tau * 5000 + 100);
  }
  free() {
    clearTimeout(this.timer);
    this.el.pause(); this.el.removeAttribute('src');
    try { this.el.load(); } catch (e) { /* ignore */ }
    this.track = null; this.state = 'idle'; this.layer = null; this.live = false;
  }
}

// A musical role (explore, tension, alarm, cue): one active deck crossfading through its tracks.
class Layer {
  constructor(music, name) { this.m = music; this.name = name; this.mood = name; this.deck = null; this.tracks = []; this.loop = true; this.level = 1; this.paused = false; this.armed = false; this.pos = {}; }
  get track() { return this.deck ? this.deck.track : null; }
  gain(t = this.track) { return (MIX[this.mood] ?? 1) * ((t && t.gain) || 1) * this.level; }
  // Start a track; the outgoing deck fades out once the new one is actually playing.
  start(track, { at = 0, tau = 1.2, outTau = tau } = {}) {
    if (!track) return null;
    const d = this.m.acquire();
    if (!d) return null;
    const old = this.deck;
    d.layer = this; d.load(track, at);
    this.deck = d; this.paused = false; this.armed = false;
    let swapped = false;
    const swap = () => { if (swapped) return; swapped = true; if (old && old !== d) { this.keep(old); old.release(outTau); } };
    d.onPlaying = () => { if (this.deck === d) d.fade(this.gain(track), tau); swap(); };
    d.play();
    if (old) setTimeout(swap, 2500); // a slow stream must not leave two beds overlapping for long
    this.m.remember(track);
    return d;
  }
  // Start from where this track was last left (tension resumes rather than restarts).
  resume(track, opts = {}) { return this.start(track, { ...opts, at: this.pos[track.id] || 0 }); }
  stop(tau = 1) { const d = this.deck; this.deck = null; this.paused = false; this.armed = false; if (d) { this.keep(d); d.release(tau); } }
  keep(d) {
    if (!d || !d.track || !d.track.id) return;
    if (isFinite(d.el.duration) && d.el.currentTime > 5 && d.el.currentTime < d.el.duration - 20) this.pos[d.track.id] = d.el.currentTime;
    else delete this.pos[d.track.id];
  }
  // Hold the element but stop decoding (the explore bed during an alarm, tension when calm).
  park() { const d = this.deck; if (!d || this.paused) return; this.keep(d); d.el.pause(); this.paused = true; }
  unpark() { const d = this.deck; if (!d || !this.paused) return; this.paused = false; d.play(); }
  next(avoid) { return this.m.pick(this.tracks, avoid); }
}

export class Music {
  constructor(engine) {
    this.a = engine;
    this.synth = new SynthScore(engine);
    this.mood = 'silence';
    this.theatre = 'Western Europe'; this.night = false;
    this.pool = []; this.out = null; this.track = null;
    this.catalog = null; this.bad = new Set(); this.lastPick = {};
    this.cue = new Layer(this, 'cue');
    this.doc = new Layer(this, 'doc');
    this.mission = null;
    this.applied = false; this.locked = false; this.timer = null;
    // Gesture hook, registered after the App's own unlock listener so the AudioContext exists
    // when it runs: unlocks the element pool (retrying on later gestures if iOS refused) and
    // starts a mood requested before the first gesture (e.g. a mission opened from the URL).
    this.onGesture = () => this.gesture();
    this.gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    setTimeout(() => { for (const ev of this.gestureEvents) window.addEventListener(ev, this.onGesture, { passive: true }); }, 0);
  }
  get ctx() { return this.a.ctx; }

  // ---------- public API (unchanged) ----------
  setTheatre(name, night = false) { this.theatre = name || 'Western Europe'; this.night = night; this.synth.setTheatre(name, night); }

  setMood(mood, force = false) {
    const prev = this.mood;
    this.mood = mood;
    if (!this.a.ready || !this.setup()) return;
    this.applied = true;
    const M = this.mission, w = this.world();
    const fromScript = w && (w.events || []).some((e) => e.type === 'music' && e.mood === mood);
    if (M && w) {
      // Fresh suspicion keeps the tension up; a script's tension holds until the script ends it.
      if (mood === 'tension') { if (fromScript) M.scripted = true; else M.hold = this.ctx.currentTime + 12; }
      if (mood === 'explore' && fromScript) M.scripted = false;
    }
    if (mood === prev && !force && !(mood === 'explore' && !M)) return;

    if (mood === 'silence') return this.silence(1.5);
    if (mood === 'explore' || mood === 'alarm' || (mood === 'tension' && w)) return this.missionMood(mood, force);
    if (mood === 'victory' || mood === 'defeat') return this.playCue(mood);
    if (mood === 'tension') return this.playCue('briefing');
    if (mood === 'title') return this.playCue(this.isEpilogue() ? 'epilogue' : 'title');
    return this.playCue(mood); // documentary, letter
  }

  stop() { this.silence(0.5); this.synth.stop(); }

  // Documentary recordings (whole pieces, looped).
  playTrack(url, { volume = 0.8, loop = true, fade = 2.5 } = {}) {
    if (!this.a.ready || !this.setup()) return;
    this.stopTrack(1.5);
    const d = this.acquire();
    if (!d) return;
    d.layer = this.doc; d.load({ id: url, url }, 0, loop);
    this.doc.deck = d; this.track = d;
    d.onPlaying = () => { if (this.doc.deck === d) d.fade(volume, fade / 3); };
    d.play();
  }
  stopTrack(fade = 2) {
    const d = this.doc.deck;
    this.doc.deck = null; this.track = null;
    if (d) d.release(fade / 3);
  }

  // A snapshot for tests and debugging.
  state() {
    const lay = (L) => (L && L.deck ? { track: L.track && (L.track.id || L.track.url), gain: +L.deck.level.toFixed(3), state: L.deck.state, paused: L.paused, armed: L.armed, t: +L.deck.el.currentTime.toFixed(1) } : null);
    const M = this.mission;
    return {
      mood: this.mood, ctx: this.ctx ? this.ctx.state : 'none', unlocked: this.pool.filter((d) => d.unlocked).length, locked: this.locked, tracks: this.catalog ? this.catalog.all.length : 0,
      cue: this.cue.deck ? { set: this.cue.mood, ...lay(this.cue) } : null, doc: lay(this.doc), synth: this.synth.mood,
      mission: M ? { id: M.id, palette: M.palette, level: +M.level.toFixed(3), scripted: M.scripted, alarm: M.alarmOn, explore: lay(M.explore), tension: lay(M.tension), alarmLayer: lay(M.alarmLayer) } : null,
      decks: this.pool.map((d) => d.state[0]).join(''),
    };
  }

  // ---------- setup, pool, gestures ----------
  setup() {
    if (this.out) return true;
    if (!this.ctx) return false;
    this.out = this.ctx.createGain(); this.out.gain.value = 1;
    this.out.connect(this.a.bus.music);
    this.loadCatalog();
    for (let i = 0; i < POOL; i++) this.pool.push(new Deck(this));
    this.timer = setInterval(() => this.tick(), 250);
    return true;
  }
  acquire() {
    let d = this.pool.find((x) => x.state === 'idle');
    if (!d) { // take over the quietest deck that is already on its way out
      d = this.pool.filter((x) => x.state === 'releasing').sort((p, q) => p.level - q.level)[0];
      if (d) d.free();
    }
    if (!d && this.pool.length < POOL + 4) { d = new Deck(this); this.pool.push(d); }
    return d || null;
  }
  gesture() {
    if (!this.a.ready || !this.setup()) return;
    const url = this.silent || (this.silent = silentUrl());
    for (const d of this.pool) {
      if (d.unlocked || d.state !== 'idle') continue;
      d.wire();
      d.el.src = url;
      const p = d.el.play();
      const done = (ok) => {
        if (ok) d.unlocked = true;
        if (d.state === 'idle') { d.el.pause(); d.el.removeAttribute('src'); try { d.el.load(); } catch (e) { /* ignore */ } }
        if (this.pool.every((x) => x.unlocked || x.state !== 'idle') && !this.locked) for (const ev of this.gestureEvents) window.removeEventListener(ev, this.onGesture);
      };
      if (p && p.then) p.then(() => done(true), () => done(false)); else done(true);
    }
    if (this.locked) {
      this.locked = false;
      for (const d of this.pool) if (d.state === 'playing' && d.el.paused && !(d.layer && (d.layer.paused || d.layer.armed))) d.play();
    }
    if (!this.applied && this.mood !== 'silence') this.setMood(this.mood, true);
  }
  playFailed(d, err) {
    if (err && err.name === 'NotAllowedError') { // retried on the next gesture
      this.locked = true;
      for (const ev of this.gestureEvents) window.addEventListener(ev, this.onGesture, { passive: true });
      return;
    }
    if (err && err.name === 'AbortError') return; // superseded by a newer load or a pause
    this.deckError(d);
  }
  deckError(d) {
    const t = d.track, L = d.layer;
    if (!t || d.state === 'idle' || d.failed) return; // the error event and the play() rejection both report
    d.failed = true;
    if (t.id) this.bad.add(t.id);
    console.warn('[music] could not play', t.url || t.file);
    d.release(0.2);
    if (!L || L.deck !== d) return;
    L.deck = null;
    if (L === this.doc) return;
    const next = L.next(t);
    if (next) L.start(next, { tau: 0.8 });
    else if (L === this.cue || L.name === 'explore' || L.name === 'alarm') this.synth.setMood(SYNTH_FOR[L.mood] || L.mood, true);
  }

  // ---------- catalogue ----------
  loadCatalog() {
    const list = app() && Array.isArray(app().tracks) ? app().tracks : null;
    if (list) return this.index(list);
    fetch('content/music.json').then((r) => (r.ok ? r.json() : [])).then((j) => {
      this.index(Array.isArray(j) ? j : []);
      if (this.mood !== 'silence') this.setMood(this.mood, true);
    }).catch(() => this.index([]));
  }
  index(list) {
    const c = { all: list.filter((t) => t && t.kind === 'score' && t.file), mood: {}, palette: {} };
    for (const t of c.all) {
      for (const m of t.moods || [t.mood]) (c.mood[m] = c.mood[m] || []).push(t);
      if (t.mood === 'explore') for (const p of t.palettes || [t.palette]) (c.palette[p] = c.palette[p] || []).push(t);
    }
    this.catalog = c;
  }
  tracksFor(mood) { return ((this.catalog && this.catalog.mood[mood]) || []).filter((t) => !this.bad.has(t.id)); }
  // Least recently heard, never the one to avoid, random among equals.
  pick(list, avoid) {
    const ok = list.filter((t) => !this.bad.has(t.id));
    if (!ok.length) return null;
    const pool = ok.length > 1 && avoid ? ok.filter((t) => t.id !== avoid.id) : ok;
    const last = this.lastPick;
    return pool.slice().sort((p, q) => ((last[p.id] || 0) - (last[q.id] || 0)) || (Math.random() - 0.5))[0];
  }
  remember(t) { if (t && t.id) this.lastPick[t.id] = performance.now(); }

  // ---------- context ----------
  screen() { const a = app(); return a ? a.screen : null; }
  world() { const s = this.screen(); return s && s.world && !s.exited ? s.world : null; }
  isEpilogue() {
    const s = this.screen(), n = s && s.constructor ? s.constructor.name : '';
    return n === 'EpilogueScreen' || (n !== 'TitleScreen' && this.theatre === 'Pacific');
  }
  missionInfo() {
    const s = this.screen();
    if (!s || !s.meta || !s.def) return { id: null, theatre: this.theatre, biome: '', weather: '' };
    return { id: s.meta.id, theatre: s.meta.theatre || this.theatre, biome: s.def.biome || s.meta.biome || '', weather: s.def.weather || s.meta.weather || '' };
  }
  paletteFor(info) {
    if (info.id && MISSION_PALETTE[info.id]) return MISSION_PALETTE[info.id];
    if (/snow|blizzard/.test(`${info.biome} ${info.weather}`)) return 'snow';
    return THEATRE_PALETTE[info.theatre] || 'west';
  }

  // ---------- cues ----------
  playCue(name) {
    this.endMission(name === 'victory' || name === 'defeat' ? 0.6 : 1.2);
    const L = this.cue;
    const list = this.tracksFor(name);
    L.mood = name; L.loop = CUE_LOOP[name] !== false; L.tracks = list;
    if (!list.length) { L.stop(1); this.synth.setMood(SYNTH_FOR[name] || name, true); return; }
    this.synth.setMood('silence');
    // Keep playing if the current cue belongs here too (title theme -> war room -> briefing).
    if (L.deck && L.deck.state === 'playing' && list.includes(L.track)) { L.deck.fade(L.gain(), 1.5); return; }
    const once = !L.loop;
    L.start(L.next(L.track), { tau: once ? 0.3 : 1.0, outTau: once ? 0.4 : 1.4 });
  }
  silence(tau) {
    this.endMission(tau * 0.6);
    this.cue.stop(tau / 3);
    this.synth.setMood('silence');
  }

  // ---------- the mission score ----------
  missionMood(mood, force) {
    const info = this.missionInfo();
    let M = this.mission;
    if (!M || M.key !== (info.id || this.theatre)) M = this.startMission(info);
    else if (force && mood === 'explore') { // same mission again (quick load, restart): keep the bed, reset the state
      M.scripted = false; M.hold = 0;
      if (!M.explore.deck) { const t = this.firstBed(M.explore.tracks, info.id); if (t) M.explore.start(t, { tau: 1.6 }); }
    }
    if (!M) return;
    const now = this.ctx.currentTime;
    if (mood === 'alarm') {
      if (M.alarmOn) return;
      M.alarmOn = true;
      this.synth.stinger('alarm', M.alarmLayer.armed ? 0.5 : 0.8);
      this.alarmIn(M);
    } else if (M.alarmOn) {
      // The alarm dies away: a slow fade back to the bed, the guards still on edge.
      M.alarmOn = false;
      M.slowUntil = now + 12; M.after = now; M.level = Math.max(M.level, 0.5);
      M.alarmLayer.stop(2.2);
      M.explore.unpark();
      if (this.synth.mood === 'alarm') this.synth.setMood(M.explore.deck ? 'silence' : 'explore');
      setTimeout(() => { if (this.mission === M && !M.alarmOn) this.arm(M); }, 12000);
      if (M.scripted) this.mood = 'tension';
    }
    if (mood === 'tension' && !M.alarmOn) M.level = Math.max(M.level, 0.35); // react at once
    this.tick();
  }

  startMission(info) {
    this.cue.stop(0.6);
    this.synth.setMood('silence');
    if (this.mission) this.endMission(0.6);
    const palette = this.paletteFor(info);
    const beds = ((this.catalog && this.catalog.palette[palette]) || []).filter((t) => !this.bad.has(t.id));
    const M = {
      key: info.id || this.theatre, id: info.id, palette, level: 0, hold: 0, scripted: false, alarmOn: false, after: -99, slowUntil: 0,
      explore: new Layer(this, 'explore'), tension: new Layer(this, 'tension'), alarmLayer: new Layer(this, 'alarm'), lastAlarm: null,
    };
    M.explore.tracks = beds.length ? beds : this.tracksFor('explore');
    M.tension.tracks = this.tracksFor('tension');
    M.alarmLayer.tracks = this.tracksFor('alarm');
    this.mission = M;
    const first = this.firstBed(M.explore.tracks, info.id);
    if (!first) { this.synth.setMood('explore', true); return M; }
    M.explore.start(first, { tau: 1.6 });
    M.slowUntil = this.ctx.currentTime + 6;
    setTimeout(() => { if (this.mission === M) this.arm(M); }, 4000);
    return M;
  }
  // The opening bed: one pinned to this mission, else the least recently opened across missions.
  firstBed(list, id) {
    const ok = list.filter((t) => !this.bad.has(t.id));
    if (!ok.length) return null;
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { recent = []; }
    if (!Array.isArray(recent)) recent = [];
    const rank = (t) => recent.indexOf(t.id); // 0 = opened the last mission, -1 = never
    let choice = id && ok.find((t) => (t.missions || []).includes(id));
    if (!choice) {
      // Never-heard beds first, else the one heard longest ago; never last mission's opener.
      const fresh = ok.filter((t) => rank(t) < 0);
      const from = fresh.length ? fresh : ok.slice().sort((p, q) => rank(q) - rank(p)).slice(0, 1);
      choice = from[Math.floor(Math.random() * from.length)];
    }
    recent = [choice.id, ...recent.filter((x) => x !== choice.id)].slice(0, 16);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch (e) { /* storage unavailable */ }
    return choice;
  }
  // Pre-load the next alarm, warmed (played silently for a moment) so that it starts at once.
  arm(M) {
    const A = M.alarmLayer;
    if (A.deck || !A.tracks.length || M.alarmOn) return;
    const t = A.next(M.lastAlarm), d = t && this.acquire();
    if (!d) return;
    d.layer = A; d.load(t); A.deck = d; A.armed = true;
    const p = d.el.play();
    const hush = () => { if (A.armed && A.deck === d) { d.el.pause(); try { d.el.currentTime = 0; } catch (e) { /* ignore */ } } };
    if (p && p.then) p.then(() => setTimeout(hush, 300), () => {}); else hush();
  }
  alarmIn(M) {
    const A = M.alarmLayer;
    if (M.explore.deck) M.explore.deck.fade(0, 0.25);
    if (M.tension.deck) M.tension.deck.fade(0, 0.3);
    if (A.deck && A.armed) {
      const d = A.deck;
      A.armed = false;
      d.onPlaying = null;
      if (d.el.paused) d.play(); else d.state = 'playing';
      d.fade(A.gain(d.track), 0.05);
      M.lastAlarm = d.track; this.remember(d.track);
    } else {
      const t = A.next(M.lastAlarm);
      if (t) { A.start(t, { tau: 0.06, outTau: 0.3 }); M.lastAlarm = t; } else this.synth.setMood('alarm', true);
    }
  }
  endMission(tau = 1) {
    const M = this.mission;
    if (!M) return;
    this.mission = null;
    for (const L of [M.explore, M.tension, M.alarmLayer]) L.stop(tau);
    if (this.synth.mood === 'explore' || this.synth.mood === 'tension' || this.synth.mood === 'alarm') this.synth.setMood('silence');
  }

  // How suspicious the garrison is right now, 0..1 (null outside a mission).
  heat() {
    const w = this.world();
    if (!w || !w.s) return null;
    if (w.s.alarm && w.s.alarm.pending) return 1;
    let h = 0;
    const list = typeof w.liveEnemies === 'function' ? w.liveEnemies() : [];
    for (const e of list) {
      const ai = e.ai;
      if (!ai) continue;
      const m = ai.mode;
      let v = m === 'alert' ? 1 : m === 'search' ? 0.75 : (m === 'investigate' || m === 'checkBody') ? 0.55 : ai.notice ? 0.35 : 0;
      if (ai.susp) for (const k in ai.susp) v = Math.max(v, Math.min(1, ai.susp[k]) * 0.6);
      if (v > h) { h = v; if (h >= 1) break; }
    }
    return h;
  }

  // ---------- the clock: crossfade loops, the layer mix, tension decay ----------
  tick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Watchdog: after an interruption (app switch, phone call) iOS leaves elements paused.
    if ((this.ticks = (this.ticks || 0) + 1) % 8 === 0 && !this.locked && this.ctx.state === 'running' && !document.hidden) {
      for (const d of this.pool) if (d.state === 'playing' && d.el.paused && !d.el.ended && !(d.layer && (d.layer.paused || d.layer.armed))) d.play();
    }
    // Cue: loop through its set with crossfades; a one-shot cue frees its deck at the end.
    const C = this.cue.deck;
    if (C && C.state === 'playing') {
      if (this.cue.loop && C.remaining < XFADE.cue && !C.handing) { C.handing = true; this.cue.start(this.cue.next(C.track), { tau: 1.6, outTau: 1.8 }); }
      else if (!this.cue.loop && C.el.ended) this.cue.stop(0.2);
    }
    const M = this.mission;
    if (!M) return;
    // Beds rotate within their palette; tension and alarm rotate through their sets.
    for (const [L, xf] of [[M.explore, XFADE.explore], [M.tension, XFADE.tension], [M.alarmLayer, XFADE.alarm]]) {
      const d = L.deck;
      if (!d || L.paused || L.armed || d.state !== 'playing' || d.handing || d.remaining >= xf) continue;
      d.handing = true;
      delete L.pos[d.track.id];
      const t = L.next(d.track);
      if (t) { L.start(t, { tau: xf / 3, outTau: xf / 3 }); if (L === M.alarmLayer) M.lastAlarm = t; }
    }
    if (M.alarmOn) {
      if (M.explore.deck && M.explore.deck.level < 0.01) M.explore.park();
      this.parkTension(M, 0.3);
      return;
    }

    // Tension wanted: scripted or just spotted -> full; otherwise it follows the guards'
    // suspicion, plus a fading residue after an alarm. Fast attack, slow release.
    const h = this.heat();
    let want = 0;
    if (this.mood === 'tension' && (M.scripted || now < M.hold || h === null)) want = 1;
    if (h !== null && h >= 0.45) want = Math.max(want, h);
    if (now - M.after < 25) want = Math.max(want, 0.5 * (1 - (now - M.after) / 25));
    M.level += (want - M.level) * (want > M.level ? 0.3 : 0.045);
    if (M.level < 0.004) M.level = 0;
    // Calm again: an unscripted tension mood returns to exploring.
    if (this.mood === 'tension' && !M.scripted && h !== null && now > M.hold && want < 0.05 && M.level < 0.06) this.mood = 'explore';

    const T = M.tension, E = M.explore;
    T.level = clamp01(M.level);
    E.level = 1 - 0.7 * clamp01(M.level);
    if (M.level > 0.02) {
      if (!T.deck) { const t = T.next(); if (t) T.resume(t); } else if (T.paused) T.unpark();
      if (T.deck && T.deck.live && T.deck.state === 'playing') T.deck.fade(T.gain(), 0.5);
    } else this.parkTension(M, 1.5);
    if (E.deck) {
      if (E.paused) E.unpark();
      if (E.deck.live && E.deck.state === 'playing') E.deck.fade(E.gain(), now < M.slowUntil ? 4 : 0.6);
    }
  }
  parkTension(M, tau) {
    const T = M.tension, d = T.deck;
    if (!d || T.paused) return;
    if (d.state === 'playing') d.fade(0, tau);
    if (d.level < 0.01) T.park();
  }
}
